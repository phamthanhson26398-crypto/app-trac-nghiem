const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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
    const currentRoom = rooms[code];
    if (!currentRoom || !parts || parts.length === 0) return;

    if (currentRoom.timer) {
      clearTimeout(currentRoom.timer);
      currentRoom.timer = null;
    }

    currentRoom.status = 'playing';
    currentRoom.currentIndex = 0;
    currentRoom.students.forEach(s => {
      s.score = 0;
      s.currentScoreAwarded = 0;
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
    currentRoom.queue = queue;

    function runQuestion() {
      if (currentRoom.currentIndex >= currentRoom.queue.length) {
        currentRoom.status = 'finished';
        io.to(code).emit('quiz_ended', { leaderboard: currentRoom.students, quizName });
        return;
      }

      const item = currentRoom.queue[currentRoom.currentIndex];
      const duration = parseInt(item.question.duration) || 10;

      currentRoom.students.forEach(s => {
        s.currentScoreAwarded = 0;
      });

      io.to(code).emit('question_started', {
        item: item,
        duration: duration
      });

      currentRoom.timer = setTimeout(() => {
        currentRoom.students.forEach(s => {
          s.score += s.currentScoreAwarded;
        });

        currentRoom.currentIndex++;
        runQuestion();
      }, (duration + 1) * 1000);
    }

    runQuestion();
  });

  // NHẬN KẾT QUẢ KHI HỌC SINH BẤM NÚT "NỘP ĐÁP ÁN"
  socket.on('submit_answer', ({ code, isCorrect, remainingTime }) => {
    const room = rooms[code];
    if (room && room.status === 'playing') {
      const student = room.students.find(s => s.id === socket.id);
      if (student) {
        student.currentScoreAwarded = isCorrect ? Math.max(1, remainingTime) : 0;
      }
    }
  });

  socket.on('disconnect', () => {});
});

server.listen(PORT, () => {
  console.log(`>>> SERVER DANG CHAY TAI PORT: ${PORT}`);
});
