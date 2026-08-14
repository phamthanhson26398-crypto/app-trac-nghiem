const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

// QUẢN LÝ TRẠNG THÁI TRỰC TIẾP
const quizState = {
  status: 'waiting', // waiting | playing | ended
  quizName: '',
  queue: [],
  currentIndex: 0,
  timeLeft: 0,
  students: {},
  gameInterval: null
};

function runNextQuestion() {
  if (quizState.currentIndex >= quizState.queue.length) {
    quizState.status = 'ended';
    if (quizState.gameInterval) {
      clearInterval(quizState.gameInterval);
      quizState.gameInterval = null;
    }
    io.emit('quiz_ended', {
      leaderboard: Object.values(quizState.students),
      quizName: quizState.quizName
    });
    return;
  }

  const currentItem = quizState.queue[quizState.currentIndex];
  quizState.timeLeft = parseInt(currentItem.question.duration) || 10;

  // Reset trạng thái nộp bài của câu này
  Object.keys(quizState.students).forEach(id => {
    quizState.students[id].currentScore = 0;
    quizState.students[id].answered = false;
  });

  // 1. Phát câu hỏi cho mọi người
  io.emit('question_started', {
    item: currentItem,
    duration: quizState.timeLeft,
    currentIndex: quizState.currentIndex,
    totalQuestions: quizState.queue.length
  });

  // 2. Vòng lặp đếm giây của Server
  if (quizState.gameInterval) clearInterval(quizState.gameInterval);
  
  quizState.gameInterval = setInterval(() => {
    quizState.timeLeft--;
    
    // Gửi tín hiệu giây đếm ngược chuẩn
    io.emit('timer_tick', { timeLeft: Math.max(0, quizState.timeLeft) });

    // HẾT GIỜ -> TỰ ĐỘNG CHUYỂN SANG CÂU TIẾP THEO
    if (quizState.timeLeft <= 0) {
      clearInterval(quizState.gameInterval);
      quizState.gameInterval = null;

      // Cộng dồn điểm câu vừa xong
      Object.keys(quizState.students).forEach(id => {
        quizState.students[id].score += quizState.students[id].currentScore;
        quizState.students[id].currentScore = 0;
      });

      quizState.currentIndex++;
      // Nghỉ 500ms rồi lập tức nạp câu tiếp theo
      setTimeout(runNextQuestion, 500);
    }
  }, 1000);
}

io.on('connection', (socket) => {
  socket.emit('update_students', Object.values(quizState.students));

  socket.on('join_room', ({ name, role }) => {
    if (role === 'student') {
      quizState.students[socket.id] = {
        id: socket.id,
        name: name || 'Đoàn sinh',
        score: 0,
        currentScore: 0,
        answered: false
      };
      io.emit('update_students', Object.values(quizState.students));
    }
  });

  socket.on('start_quiz', ({ parts, quizName }) => {
    if (!parts || parts.length === 0) return;

    if (quizState.gameInterval) {
      clearInterval(quizState.gameInterval);
      quizState.gameInterval = null;
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

    quizState.status = 'playing';
    quizState.quizName = quizName || 'Bài thi';
    quizState.queue = queue;
    quizState.currentIndex = 0;

    // Reset điểm toàn bộ
    Object.keys(quizState.students).forEach(id => {
      quizState.students[id].score = 0;
      quizState.students[id].currentScore = 0;
      quizState.students[id].answered = false;
    });

    // Chạy câu 1
    runNextQuestion();
  });

  socket.on('submit_answer', ({ isCorrect, remainingTime }) => {
    if (quizState.status === 'playing' && quizState.students[socket.id]) {
      const student = quizState.students[socket.id];
      if (!student.answered) {
        student.answered = true;
        // Điểm = số giây còn lại ngay lúc bấm nộp
        student.currentScore = isCorrect ? Math.max(1, parseInt(remainingTime) || quizState.timeLeft) : 0;
      }
    }
  });

  socket.on('disconnect', () => {});
});

server.listen(PORT, () => {
  console.log(`Server is running on PORT: ${PORT}`);
});
