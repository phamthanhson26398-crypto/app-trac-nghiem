const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

const state = {
  status: 'waiting',
  quizName: '',
  queue: [],
  currentIndex: 0,
  currentItem: null,
  currentDuration: 0,
  students: {},
  timerTimeout: null
};

io.on('connection', (socket) => {
  socket.emit('update_students', Object.values(state.students));

  socket.on('join_room', ({ name, role }) => {
    if (role === 'student') {
      state.students[socket.id] = {
        id: socket.id,
        name: name || 'Thí sinh',
        score: 0,
        currentScore: 0,
        answered: false
      };
      io.emit('update_students', Object.values(state.students));

      if (state.status === 'playing' && state.currentItem) {
        socket.emit('question_started', {
          item: state.currentItem,
          duration: state.currentDuration,
          currentIndex: state.currentIndex,
          totalQuestions: state.queue.length
        });
      }
    }
  });

  socket.on('start_quiz', ({ parts, quizName }) => {
    if (!parts || parts.length === 0) return;

    if (state.timerTimeout) {
      clearTimeout(state.timerTimeout);
      state.timerTimeout = null;
    }

    const queue = [];
    parts.forEach((p, pIdx) => {
      p.questions.forEach((q, qIdx) => {
        queue.push({
          partTitle: p.title,
          partIndex: pIdx + 1,
          totalParts: parts.length,
          questionIndex: qIdx + 1,
          totalQuestionsInPart: p.questions.length,
          question: q
        });
      });
    });

    if (queue.length === 0) return;

    state.status = 'playing';
    state.quizName = quizName || 'Bài thi';
    state.queue = queue;
    state.currentIndex = 0;

    Object.keys(state.students).forEach(id => {
      state.students[id].score = 0;
      state.students[id].currentScore = 0;
      state.students[id].answered = false;
    });

    function dispatchQuestion() {
      if (state.currentIndex >= state.queue.length) {
        state.status = 'ended';
        state.currentItem = null;
        if (state.timerTimeout) clearTimeout(state.timerTimeout);
        io.emit('quiz_ended', { 
          leaderboard: Object.values(state.students), 
          quizName: state.quizName 
        });
        return;
      }

      state.currentItem = state.queue[state.currentIndex];
      state.currentDuration = parseInt(state.currentItem.question.duration) || 10;

      Object.keys(state.students).forEach(id => {
        state.students[id].currentScore = 0;
        state.students[id].answered = false;
      });

      // Phát câu hỏi kèm số giây chuẩn
      io.emit('question_started', {
        item: state.currentItem,
        duration: state.currentDuration,
        currentIndex: state.currentIndex,
        totalQuestions: state.queue.length
      });

      // Server đợi đúng hết số giây của câu hỏi -> cộng điểm và chuyển câu
      state.timerTimeout = setTimeout(() => {
        Object.keys(state.students).forEach(id => {
          state.students[id].score += state.students[id].currentScore;
          state.students[id].currentScore = 0;
        });

        state.currentIndex++;
        dispatchQuestion();
      }, state.currentDuration * 1000);
    }

    dispatchQuestion();
  });

  socket.on('submit_answer', ({ isCorrect, remainingTime }) => {
    if (state.status === 'playing' && state.students[socket.id]) {
      const student = state.students[socket.id];
      if (!student.answered) {
        student.answered = true;
        student.currentScore = isCorrect ? Math.max(1, parseInt(remainingTime) || 0) : 0;
      }
    }
  });

  socket.on('disconnect', () => {});
});

server.listen(PORT, () => {
  console.log(`Server running on port: ${PORT}`);
});
