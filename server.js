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
        currentItemIndex: 0,
        queue: []
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
    if (!rooms[code] || !parts || parts.length === 0) return;

    const currentRoom = rooms[code];

    // 1. DỌN SẠCH TIMER CŨ ĐANG CHẠY (NẾU CÓ) ĐỂ KHÔNG BỊ TRÙNG LẶP
    if (currentRoom.timer) {
      clearInterval(currentRoom.timer);
      currentRoom.timer = null;
    }

    // 2. RESET ĐIỂM SỐ VÀ TRẠNG THÁI
    currentRoom.status = 'playing';
    currentRoom.currentItemIndex = 0;
    currentRoom.students.forEach(s => {
      s.score = 0;
      s.currentChoiceIsCorrect = false;
      s.timeRemainingAtAnswer = 0;
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

    function runNextQuestion() {
      // HỦY BỎ BẤT KỲ TIMER NÀO TRƯỚC ĐÓ KHI CHUYỂN CÂU
      if (currentRoom.timer) {
        clearInterval(currentRoom.timer);
        currentRoom.timer = null;
      }

      if (currentRoom.currentItemIndex >= currentRoom.queue.length) {
        currentRoom.status = 'finished';
        io.to(code).emit('quiz_ended', { leaderboard: currentRoom.students, quizName });
        return;
      }

      const item = currentRoom.queue[currentRoom.currentItemIndex];
      
      // Reset lượt trả lời của câu này
      currentRoom.students.forEach(s => { 
        s.currentChoiceIsCorrect = false; 
        s.timeRemainingAtAnswer = 0;
      });

      io.to(code).emit('question_started', item);

      let timeLeft = parseInt(item.question.duration) || 10;
      currentRoom.currentTimeLeft = timeLeft;
      io.to(code).emit('timer_tick', { timeLeft });

      // KHỞI ĐỘNG BỘ ĐẾM RIÊNG CỦA PHÒNG THI
      currentRoom.timer = setInterval(() => {
        timeLeft--;
        currentRoom.currentTimeLeft = timeLeft;
        io.to(code).emit('timer_tick', { timeLeft });

        if (timeLeft <= 0) {
          clearInterval(currentRoom.timer);
          currentRoom.timer = null;

          // Hết giờ: Cộng điểm cho các bạn chọn đúng theo số giây còn lại
          currentRoom.students.forEach(s => {
            if (s.currentChoiceIsCorrect) {
              s.score += s.timeRemainingAtAnswer;
            }
          });

          currentRoom.currentItemIndex++;
          runNextQuestion();
        }
      }, 1000);
    }

    runNextQuestion();
  });

  socket.on('update_choice', ({ code, isCorrect }) => {
    const room = rooms[code];
    if (room && room.status === 'playing') {
      const student = room.students.find(s => s.id === socket.id);
      if (student) {
        student.currentChoiceIsCorrect = isCorrect;
        student.timeRemainingAtAnswer = room.currentTimeLeft || 0;
      }
    }
  });

  socket.on('disconnect', () => {
    // Tự động dọn dẹp khi mất kết nối
  });
});

server.listen(PORT, () => {
  console.log(`>>> SERVER DANG CHAY TAI PORT: ${PORT}`);
});
