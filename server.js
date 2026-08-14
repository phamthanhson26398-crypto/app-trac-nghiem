const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000
});

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
        students: {}, 
        status: 'waiting',
        timer: null,
        queue: [],
        currentIndex: 0
      };
    }

    if (role === 'student') {
      rooms[code].students[socket.id] = {
        id: socket.id,
        name: name,
        score: 0,
        currentScoreAwarded: 0,
        hasAnswered: false
      };
      io.to(code).emit('update_students', Object.values(rooms[code].students));
    }
  });

  socket.on('start_quiz', ({ code, parts, quizName }) => {
    const room = rooms[code];
    if (!room || !parts || parts.length === 0) return;

    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }

    room.status = 'playing';
    room.currentIndex = 0;
    
    // Reset điểm tất cả học sinh
    Object.values(room.students).forEach(s => {
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

    function playNext() {
      if (room.timer) {
        clearTimeout(room.timer);
        room.timer = null;
      }

      if (room.currentIndex >= room.queue.length) {
        room.status = 'finished';
        io.to(code).emit('quiz_ended', { 
          leaderboard: Object.values(room.students), 
          quizName 
        });
        return;
      }

      const item = room.queue[room.currentIndex];
      const duration = parseInt(item.question.duration) || 10;
      const endTime = Date.now() + duration * 1000;

      // Reset lượt câu này
      Object.values(room.students).forEach(s => {
        s.currentScoreAwarded = 0;
        s.hasAnswered = false;
      });

      // Bắn câu hỏi kèm mốc thời gian tuyệt đối
      io.to(code).emit('question_started', {
        item,
        duration,
        endTime
      });

      // Server tự động hẹn giờ chuyển câu (kèm 1.2s độ trễ mạng)
      room.timer = setTimeout(() => {
        // Hết giờ: Cộng điểm tích lũy
        Object.values(room.students).forEach(s => {
          s.score += s.currentScoreAwarded;
        });

        room.currentIndex++;
        playNext();
      }, (duration * 1000) + 1200);
    }

    playNext();
  });

  socket.on('submit_answer', ({ code, isCorrect, remainingTime }) => {
    const room = rooms[code];
    if (room && room.status === 'playing') {
      const student = room.students[socket.id];
      if (student && !student.hasAnswered) {
        student.hasAnswered = true;
        student.currentScoreAwarded = isCorrect ? Math.max(1, parseInt(remainingTime) || 0) : 0;
      }
    }
  });

  socket.on('disconnect', () => {});
});

server.listen(PORT, () => {
  console.log(`Server running on port: ${PORT}`);
});
