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

// BỘ TRẠNG THÁI TRUNG TÂM CỦA HỆ THỐNG
const state = {
  status: 'waiting', // waiting | playing | ended
  quizName: '',
  queue: [],
  currentIndex: 0,
  currentEndTime: 0,
  currentItem: null,
  currentDuration: 0,
  students: {},
  loopInterval: null
};

io.on('connection', (socket) => {
  // Gửi danh sách học sinh hiện tại khi có người vào
  socket.emit('update_students', Object.values(state.students));

  // Nếu bài thi đang chạy mà có học sinh vào hoặc tải lại trang -> đồng bộ ngay câu hỏi hiện tại
  if (state.status === 'playing' && state.currentItem) {
    socket.emit('question_started', {
      item: state.currentItem,
      duration: state.currentDuration,
      endTime: state.currentEndTime,
      currentIndex: state.currentIndex,
      totalQuestions: state.queue.length
    });
  }

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

      // Nếu đang thi, phát ngay câu hỏi cho thí sinh vừa báo danh xong
      if (state.status === 'playing' && state.currentItem) {
        socket.emit('question_started', {
          item: state.currentItem,
          duration: state.currentDuration,
          endTime: state.currentEndTime,
          currentIndex: state.currentIndex,
          totalQuestions: state.queue.length
        });
      }
    }
  });

  socket.on('start_quiz', ({ parts, quizName }) => {
    if (!parts || parts.length === 0) return;

    if (state.loopInterval) {
      clearInterval(state.loopInterval);
      state.loopInterval = null;
    }

    // Gom toàn bộ câu hỏi của các phần vào hàng đợi
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

    // Reset điểm
    Object.keys(state.students).forEach(id => {
      state.students[id].score = 0;
      state.students[id].currentScore = 0;
      state.students[id].answered = false;
    });

    function dispatchQuestion() {
      if (state.currentIndex >= state.queue.length) {
        state.status = 'ended';
        state.currentItem = null;
        if (state.loopInterval) clearInterval(state.loopInterval);
        io.emit('quiz_ended', { 
          leaderboard: Object.values(state.students), 
          quizName: state.quizName 
        });
        return;
      }

      state.currentItem = state.queue[state.currentIndex];
      state.currentDuration = parseInt(state.currentItem.question.duration) || 10;
      state.currentEndTime = Date.now() + (state.currentDuration * 1000);

      // Reset câu này
      Object.keys(state.students).forEach(id => {
        state.students[id].currentScore = 0;
        state.students[id].answered = false;
      });

      // Phát câu hỏi cho toàn bộ máy (cả giáo viên và học sinh)
      io.emit('question_started', {
        item: state.currentItem,
        duration: state.currentDuration,
        endTime: state.currentEndTime,
        currentIndex: state.currentIndex,
        totalQuestions: state.queue.length
      });
    }

    // Chạy câu 1
    dispatchQuestion();

    // VÒNG ĐIỀU PHỐI THỜI GIAN TRUNG TÂM
    state.loopInterval = setInterval(() => {
      if (state.status !== 'playing') return;

      const now = Date.now();
      // Khi đã hết giờ làm bài của câu (+ 1 giây đệm)
      if (now >= state.currentEndTime + 1000) {
        // Cộng dồn điểm
        Object.keys(state.students).forEach(id => {
          state.students[id].score += state.students[id].currentScore;
          state.students[id].currentScore = 0;
        });

        // Chuyển sang câu tiếp theo
        state.currentIndex++;
        dispatchQuestion();
      }
    }, 400);
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
  console.log(`Server listening on PORT: ${PORT}`);
});
