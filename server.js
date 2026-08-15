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

const MASCOTS = [
  { icon: '🦁', title: 'Sư Tử Dũng Mãnh' },
  { icon: '🐯', title: 'Hổ Con Nhanh Nhẹn' },
  { icon: '🦊', title: 'Cáo Thông Thái' },
  { icon: '🐼', title: 'Gấu Trúc Cute' },
  { icon: '🦄', title: 'Kỳ Lân Phép Thuật' },
  { icon: '🐬', title: 'Cá Heo Thân Thiện' },
  { icon: '🦅', title: 'Đại Bàng Tinh Anh' },
  { icon: '🐲', title: 'Rồng Lửa Uy Lực' },
  { icon: '🐨', title: 'Koala Hiền Lành' },
  { icon: '🦉', title: 'Cú Mèo Tri Thức' },
  { icon: '🐺', title: 'Sói Đầu Đàn' },
  { icon: '🦖', title: 'Khủng Long Bạo Chúa' },
  { icon: '🚀', title: 'Phi Hành Gia' },
  { icon: '⚡', title: 'Tia Chớp Thần Tốc' },
  { icon: '🌟', title: 'Ngôi Sao May Mắn' },
  { icon: '🦹', title: 'Siêu Anh Hùng' }
];

const state = {
  status: 'waiting',
  quizName: '',
  queue: [],
  currentIndex: 0,
  currentItem: null,
  currentDuration: 0,
  students: {},
  timerTimeout: null,
  isAdvancing: false
};

function advanceToNextQuestion() {
  if (state.isAdvancing || state.status !== 'playing') return;
  state.isAdvancing = true;

  if (state.timerTimeout) {
    clearTimeout(state.timerTimeout);
    state.timerTimeout = null;
  }

  Object.keys(state.students).forEach(id => {
    const st = state.students[id];
    st.score += st.currentScore;

    if (st.answered) {
      if (st.currentScore > 0) {
        st.correctCount = (st.correctCount || 0) + 1;
      } else {
        st.wrongCount = (st.wrongCount || 0) + 1;
      }
    } else {
      st.unansweredCount = (st.unansweredCount || 0) + 1;
    }

    st.currentScore = 0;
  });

  state.currentIndex++;

  if (state.currentIndex >= state.queue.length) {
    state.status = 'ended';
    state.currentItem = null;
    io.emit('quiz_ended', { 
      leaderboard: Object.values(state.students), 
      quizName: state.quizName 
    });
    return;
  }

  setTimeout(() => {
    state.currentItem = state.queue[state.currentIndex];
    state.currentDuration = parseInt(state.currentItem.question.duration) || 10;

    Object.keys(state.students).forEach(id => {
      state.students[id].currentScore = 0;
      state.students[id].answered = false;
    });

    state.isAdvancing = false;

    io.emit('question_started', {
      item: state.currentItem,
      duration: state.currentDuration,
      currentIndex: state.currentIndex,
      totalQuestions: state.queue.length
    });

    state.timerTimeout = setTimeout(() => {
      advanceToNextQuestion();
    }, (state.currentDuration + 4) * 1000);
  }, 3000);
}

io.on('connection', (socket) => {
  socket.emit('update_students', Object.values(state.students));

  socket.on('join_room', ({ name, role }) => {
    if (role === 'student') {
      const randomMascot = MASCOTS[Math.floor(Math.random() * MASCOTS.length)];

      state.students[socket.id] = {
        id: socket.id,
        name: name || 'Đoàn sinh',
        mascot: randomMascot,
        score: 0,
        currentScore: 0,
        answered: false,
        correctCount: 0,
        wrongCount: 0,
        unansweredCount: 0
      };
      
      socket.emit('my_mascot_assigned', randomMascot);
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
    if (!parts || !Array.isArray(parts) || parts.length === 0) return;

    if (state.timerTimeout) {
      clearTimeout(state.timerTimeout);
      state.timerTimeout = null;
    }

    const queue = [];
    parts.forEach((p, pIdx) => {
      if (p.questions && Array.isArray(p.questions)) {
        p.questions.forEach((q, qIdx) => {
          queue.push({
            partTitle: p.title || `Phần ${pIdx + 1}`,
            partIndex: pIdx + 1,
            totalParts: parts.length,
            questionIndex: qIdx + 1,
            totalQuestionsInPart: p.questions.length,
            question: q
          });
        });
      }
    });

    if (queue.length === 0) return;

    state.status = 'playing';
    state.quizName = quizName || 'Bài thi';
    state.queue = queue;
    state.currentIndex = -1;
    state.isAdvancing = false;

    Object.keys(state.students).forEach(id => {
      state.students[id].score = 0;
      state.students[id].currentScore = 0;
      state.students[id].answered = false;
      state.students[id].correctCount = 0;
      state.students[id].wrongCount = 0;
      state.students[id].unansweredCount = 0;
    });

    advanceToFirstQuestion();
  });

  function advanceToFirstQuestion() {
    state.currentIndex = 0;
    state.currentItem = state.queue[0];
    state.currentDuration = parseInt(state.currentItem.question.duration) || 10;
    state.isAdvancing = false;

    io.emit('question_started', {
      item: state.currentItem,
      duration: state.currentDuration,
      currentIndex: state.currentIndex,
      totalQuestions: state.queue.length
    });

    state.timerTimeout = setTimeout(() => {
      advanceToNextQuestion();
    }, (state.currentDuration + 4) * 1000);
  }

  socket.on('time_up', () => {
    if (state.status === 'playing') {
      advanceToNextQuestion();
    }
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
