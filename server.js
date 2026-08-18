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

const rooms = {};

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      status: 'waiting',
      quizType: 'mc', // 'mc' hoặc 'essay'
      quizName: '',
      queue: [],
      currentIndex: 0,
      currentItem: null,
      currentDuration: 0,
      students: {},
      timerTimeout: null,
      isAdvancing: false
    };
  }
  return rooms[roomId];
}

function advanceToNextQuestion(roomId) {
  const room = rooms[roomId];
  if (!room || room.isAdvancing || room.status !== 'playing') return;
  room.isAdvancing = true;

  if (room.timerTimeout) {
    clearTimeout(room.timerTimeout);
    room.timerTimeout = null;
  }

  // Cộng dồn điểm và thống kê
  Object.keys(room.students).forEach(id => {
    const st = room.students[id];
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

  room.currentIndex++;

  if (room.currentIndex >= room.queue.length) {
    room.status = 'ended';
    room.currentItem = null;
    io.to(roomId).emit('quiz_ended', { 
      quizName: room.quizName,
      quizType: room.quizType
    });
    return;
  }

  setTimeout(() => {
    room.currentItem = room.queue[room.currentIndex];
    room.currentDuration = parseInt(room.currentItem.question.duration) || 10;

    Object.keys(room.students).forEach(id => {
      room.students[id].currentScore = 0;
      room.students[id].answered = false;
    });

    room.isAdvancing = false;

    io.to(roomId).emit('question_started', {
      item: room.currentItem,
      duration: room.currentDuration,
      currentIndex: room.currentIndex,
      totalQuestions: room.queue.length,
      quizType: room.quizType
    });

    room.timerTimeout = setTimeout(() => {
      advanceToNextQuestion(roomId);
    }, (room.currentDuration + 4) * 1000);
  }, 3000);
}

io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.on('join_room', ({ name, role, roomId }) => {
    if (!roomId) roomId = 'default_room';
    currentRoomId = roomId;
    socket.join(roomId);

    const room = getOrCreateRoom(roomId);

    if (role === 'student') {
      const randomMascot = MASCOTS[Math.floor(Math.random() * MASCOTS.length)];

      room.students[socket.id] = {
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
      io.to(roomId).emit('update_students', Object.values(room.students));

      if (room.status === 'playing' && room.currentItem) {
        socket.emit('question_started', {
          item: room.currentItem,
          duration: room.currentDuration,
          currentIndex: room.currentIndex,
          totalQuestions: room.queue.length,
          quizType: room.quizType
        });
      }
    } else if (role === 'teacher') {
      socket.emit('update_students', Object.values(room.students));
    }
  });

  socket.on('kick_student', ({ studentId, roomId }) => {
    const targetRoomId = roomId || currentRoomId;
    if (targetRoomId && rooms[targetRoomId] && rooms[targetRoomId].students[studentId]) {
      delete rooms[targetRoomId].students[studentId];
      io.to(studentId).emit('kicked_by_teacher');
      io.to(targetRoomId).emit('update_students', Object.values(rooms[targetRoomId].students));
    }
  });

  socket.on('clear_room_students', ({ roomId }) => {
    const targetRoomId = roomId || currentRoomId;
    if (targetRoomId && rooms[targetRoomId]) {
      socket.to(targetRoomId).emit('kicked_by_teacher');
      rooms[targetRoomId].students = {};
      rooms[targetRoomId].status = 'waiting';
      io.to(targetRoomId).emit('update_students', []);
    }
  });

  socket.on('start_quiz', ({ parts, quizName, roomId, quizType }) => {
    if (!roomId) roomId = currentRoomId || 'default_room';
    const room = getOrCreateRoom(roomId);

    if (!parts || !Array.isArray(parts) || parts.length === 0) return;

    if (room.timerTimeout) {
      clearTimeout(room.timerTimeout);
      room.timerTimeout = null;
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

    room.status = 'playing';
    room.quizType = quizType || 'mc';
    room.quizName = quizName || 'Bài thi';
    room.queue = queue;
    room.currentIndex = -1;
    room.isAdvancing = false;

    Object.keys(room.students).forEach(id => {
      room.students[id].score = 0;
      room.students[id].currentScore = 0;
      room.students[id].answered = false;
      room.students[id].correctCount = 0;
      room.students[id].wrongCount = 0;
      room.students[id].unansweredCount = 0;
    });

    room.currentIndex = 0;
    room.currentItem = room.queue[0];
    room.currentDuration = parseInt(room.currentItem.question.duration) || 10;
    room.isAdvancing = false;

    io.to(roomId).emit('question_started', {
      item: room.currentItem,
      duration: room.currentDuration,
      currentIndex: room.currentIndex,
      totalQuestions: room.queue.length,
      quizType: room.quizType
    });

    room.timerTimeout = setTimeout(() => {
      advanceToNextQuestion(roomId);
    }, (room.currentDuration + 4) * 1000);
  });

  socket.on('time_up', () => {
    if (currentRoomId && rooms[currentRoomId] && rooms[currentRoomId].status === 'playing') {
      advanceToNextQuestion(currentRoomId);
    }
  });

  socket.on('submit_answer', ({ isCorrect, remainingTime }) => {
    if (currentRoomId && rooms[currentRoomId] && rooms[currentRoomId].status === 'playing') {
      const room = rooms[currentRoomId];
      if (room.students[socket.id]) {
        const student = room.students[socket.id];
        if (!student.answered) {
          student.answered = true;
          student.currentScore = isCorrect ? Math.max(1, parseInt(remainingTime) || 0) : 0;
        }
      }
    }
  });

  socket.on('reveal_results', ({ roomId }) => {
    const targetRoomId = roomId || currentRoomId;
    if (targetRoomId && rooms[targetRoomId]) {
      io.to(targetRoomId).emit('results_revealed', {
        leaderboard: Object.values(rooms[targetRoomId].students),
        quizName: rooms[targetRoomId].quizName,
        quizType: rooms[targetRoomId].quizType
      });
    }
  });

  socket.on('disconnect', () => {});
});

server.listen(PORT, () => {
  console.log(`Server listening on PORT: ${PORT}`);
});
