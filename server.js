const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// CẤU HÌNH PHỤC VỤ CÁC FILE TĨNH TRONG THƯ MỤC PUBLIC
app.use(express.static(path.join(__dirname, 'public')));

// ĐẢM BẢO MÁY CHỦ CLOUD TRẢ VỀ FILE INDEX.HTML KHI TRUY CẬP TRANG CHỦ
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// HÀM TỰ ĐỘNG TÌM ĐỊA CHỈ IPV4 KHI CHẠY Ở MÁY CÁ NHÂN
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const ifaceList = interfaces[devName];
    for (let i = 0; i < ifaceList.length; i++) {
      const alias = ifaceList[i];
      if (alias.family === 'IPv4' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT || 3000;

app.get('/api/server-info', (req, res) => {
  res.json({
    ip: getLocalIpAddress(),
    port: PORT
  });
});

const rooms = {};

io.on('connection', (socket) => {
  socket.on('join_room', ({ code, name, role }) => {
    socket.join(code);
    if (!rooms[code]) {
      rooms[code] = { students: [], status: 'waiting' };
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

    rooms[code].students.forEach(s => {
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

    let currentItemIndex = 0;

    function runNextQuestion() {
      if (currentItemIndex >= queue.length) {
        io.to(code).emit('quiz_ended', { leaderboard: rooms[code].students, quizName });
        return;
      }

      const item = queue[currentItemIndex];
      rooms[code].students.forEach(s => { 
        s.currentChoiceIsCorrect = false; 
        s.timeRemainingAtAnswer = 0;
      });

      io.to(code).emit('question_started', item);

      let timeLeft = parseInt(item.question.duration) || 10;
      rooms[code].currentTimeLeft = timeLeft;
      io.to(code).emit('timer_tick', { timeLeft });

      const timer = setInterval(() => {
        timeLeft--;
        rooms[code].currentTimeLeft = timeLeft;
        io.to(code).emit('timer_tick', { timeLeft });

        if (timeLeft <= 0) {
          clearInterval(timer);
          rooms[code].students.forEach(s => {
            if (s.currentChoiceIsCorrect) {
              s.score += s.timeRemainingAtAnswer;
            }
          });

          currentItemIndex++;
          runNextQuestion();
        }
      }, 1000);
    }

    runNextQuestion();
  });

  socket.on('update_choice', ({ code, isCorrect }) => {
    const room = rooms[code];
    if (room) {
      const student = room.students.find(s => s.id === socket.id);
      if (student) {
        student.currentChoiceIsCorrect = isCorrect;
        student.timeRemainingAtAnswer = room.currentTimeLeft || 0;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`>>> SERVER DANG CHAY TAI PORT: ${PORT}`);
});