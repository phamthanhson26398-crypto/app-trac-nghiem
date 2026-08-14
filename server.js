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
const rooms = {};

io.on('connection', (socket) => {
  socket.on('join_room', ({ code, name, role }) => {
    socket.join(code);
    if (!rooms[code]) {
      rooms[code] = { 
        students: [], 
        status: 'waiting',
        timer: null,
        queue: [],
        currentIndex: 0
      };
    }

    if (role === 'student') {
      const existing = rooms[code].students.find(s => s.id === socket.id);
      if (!existing) {
        rooms[code].students.push({ id: socket.id, name: name, score: 0 });
      }
      io.to(code).emit('update_students', rooms[code].students);
    }
  });

  socket.on('start_quiz', ({ code, parts, quizName }) => {
    const room = rooms[code];
    if (!room || !parts || parts.length === 0) return;

    if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }

    room.status = 'playing';
    room.currentIndex = 0;
    room.students.forEach(s => {
      s.score = 0;
      s.currentScoreAwarded = 0;
      s.hasAnswered = false;
    });

    const queue = [];
    parts.forEach((part, pIdx) => {
      part.questions.forEach((q, qIdx) => {
        queue.push({
          partTitle: part.title,
          partIndex: pIdx + 1,
          totalParts: parts.length,
          questionIndex: qIdx + 1,
          totalQuestionsInPart: part.questions.length,
          question: q
        });
      });
    });
    room.queue = queue;

    function playCurrentQuestion() {
      if (room.currentIndex >= room.queue.length) {
        room.status = 'finished';
        io.to(code).emit('quiz_ended', { leaderboard: room.students, quizName });
        return;
      }

      const item = room.queue[room.currentIndex];
      let timeLeft = parseInt(item.question.duration) || 10;

      // Reset trạng thái nộp bài từng thí sinh
      room.students.forEach(s => {
        s.currentScoreAwarded = 0;
        s.hasAnswered = false;
      });

      // Bắn câu hỏi mới và số giây ban đầu
      io.to(code).emit('question_started', { item, duration: timeLeft });

      // Vòng lặp đếm ngược chính thức
      room.timer = setInterval(() => {
        timeLeft--;
        io.to(code).emit('timer_sync', { timeLeft: Math.max(0, timeLeft) });

        if (timeLeft <= 0) {
          clearInterval(room.timer);
          room.timer = null;

          // Hết giờ: Cộng điểm
          room.students.forEach(s => {
            s.score += s.currentScoreAwarded;
          });

          // Nhảy sang câu tiếp theo
          room.currentIndex++;
          setTimeout(playCurrentQuestion, 1000);
        }
      }, 1000);
    }

    playCurrentQuestion();
  });

  socket.on('submit_answer', ({ code, isCorrect, remainingTime }) => {
    const room = rooms[code];
    if (room && room.status === 'playing') {
      const student = room.students.find(s => s.id === socket.id);
      if (student && !student.hasAnswered) {
        student.hasAnswered = true;
        student.currentScoreAwarded = isCorrect ? Math.max(1, remainingTime) : 0;
      }
    }
  });

  socket.on('disconnect', () => {});
});

server.listen(PORT, () => {
  console.log(`Server listening on PORT: ${PORT}`);
});
