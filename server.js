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

const teachersDB = {};
const rooms = {};

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      status: 'waiting',
      quizName: '',
      queue: [],
      currentIndex: 0,
      currentItem: null,
      students: {},
      essaySubmissions: [],
      
      // Timer Controller Mới
      timerInterval: null,
      phase: 'question', // 'question' | 'transition'
      phaseTimeLeft: 0,
      isPaused: false
    };
  }
  return rooms[roomId];
}

// Hàm khởi chạy bộ đếm độc lập trên Server
function startRoomTimer(roomId) {
  const room = rooms[roomId];
  if (room.timerInterval) clearInterval(room.timerInterval);

  room.timerInterval = setInterval(() => {
    if (room.isPaused) return; // Nếu bị tạm dừng -> Đóng băng thời gian

    room.phaseTimeLeft--;

    if (room.phaseTimeLeft <= 0) {
      if (room.phase === 'question') {
        // HẾT GIỜ LÀM BÀI -> CHUYỂN SANG PHASE CHỜ (3 GIÂY)
        room.phase = 'transition';
        room.phaseTimeLeft = 3; 
        io.to(roomId).emit('question_time_up');

        // Tính điểm cho học sinh
        Object.keys(room.students).forEach(id => {
          const st = room.students[id];
          st.score += st.currentScore;
          
          const currentQType = room.currentItem && room.currentItem.question ? room.currentItem.question.type : 'multiple';
          
          if (currentQType === 'short_answer') {
            if (st.answered) {
              if (st.currentScore > 0) st.essayCorrect = (st.essayCorrect || 0) + 1;
              else st.essayWrong = (st.essayWrong || 0) + 1;
            } else st.essayUnanswered = (st.essayUnanswered || 0) + 1;
          } else {
            if (st.answered) {
              if (st.currentScore > 0) st.mcCorrect = (st.mcCorrect || 0) + 1;
              else st.mcWrong = (st.mcWrong || 0) + 1;
            } else st.mcUnanswered = (st.mcUnanswered || 0) + 1;
          }
          st.currentScore = 0;
        });

      } else if (room.phase === 'transition') {
        // HẾT 3 GIÂY CHỜ -> LOAD CÂU HỎI MỚI HOẶC KẾT THÚC
        room.currentIndex++;
        if (room.currentIndex >= room.queue.length) {
          clearInterval(room.timerInterval);
          room.status = 'ended';
          io.to(roomId).emit('quiz_ended', { 
            quizName: room.quizName,
            essaySubmissions: room.essaySubmissions,
            leaderboard: Object.values(room.students)
          });
        } else {
          room.phase = 'question';
          room.currentItem = room.queue[room.currentIndex];
          room.phaseTimeLeft = parseInt(room.currentItem.question.duration) || 10;
          
          Object.keys(room.students).forEach(id => {
            room.students[id].answered = false;
          });

          io.to(roomId).emit('question_started', {
            item: room.currentItem,
            duration: room.phaseTimeLeft,
            currentIndex: room.currentIndex,
            totalQuestions: room.queue.length
          });
        }
      }
    }
  }, 1000);
}

io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.on('teacher_register', ({ username, password }) => {
    if (!username || !password) return socket.emit('auth_response', { success: false, message: 'Vui lòng điền đủ thông tin!' });
    if (teachersDB[username]) return socket.emit('auth_response', { success: false, message: 'Tên tài khoản này đã tồn tại!' });
    teachersDB[username] = password;
    socket.emit('auth_response', { success: true, isRegister: true, message: 'Đăng ký thành công! Hãy đăng nhập.' });
    io.emit('admin_user_list_update', teachersDB);
  });

  socket.on('teacher_login', ({ username, password }) => {
    if (teachersDB[username] && teachersDB[username] === password) {
      socket.emit('auth_response', { success: true, isRegister: false, username: username });
    } else {
      socket.emit('auth_response', { success: false, message: 'Sai tên tài khoản hoặc mật khẩu!' });
    }
  });

  socket.on('admin_get_users', () => { socket.emit('admin_user_list_update', teachersDB); });

  socket.on('admin_reset_pass', ({ username, newPass }) => {
    if (teachersDB[username]) {
      teachersDB[username] = newPass;
      io.emit('admin_user_list_update', teachersDB);
    }
  });

  socket.on('admin_delete_user', ({ username }) => {
    if (teachersDB[username]) {
      delete teachersDB[username];
      io.emit('admin_user_list_update', teachersDB);
    }
  });

  socket.on('join_room', ({ name, role, roomId }) => {
    if (!roomId) roomId = 'default_room';
    currentRoomId = roomId;
    socket.join(roomId);
    const room = getOrCreateRoom(roomId);

    if (role === 'student') {
      const randomMascot = MASCOTS[Math.floor(Math.random() * MASCOTS.length)];
      room.students[socket.id] = {
        id: socket.id, name: name || 'Đoàn sinh', mascot: randomMascot, score: 0, currentScore: 0,
        answered: false, mcCorrect: 0, mcWrong: 0, mcUnanswered: 0, essayCorrect: 0, essayWrong: 0, essayUnanswered: 0
      };
      socket.emit('my_mascot_assigned', randomMascot);
      io.to(roomId).emit('update_students', Object.values(room.students));

      // Gửi trạng thái hiện tại cho HS vào trễ
      if (room.status === 'playing' && room.currentItem) {
        if (room.phase === 'question') {
          socket.emit('question_started', {
            item: room.currentItem, duration: room.phaseTimeLeft,
            currentIndex: room.currentIndex, totalQuestions: room.queue.length
          });
        }
        if (room.isPaused) socket.emit('quiz_paused');
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
      rooms[targetRoomId].essaySubmissions = [];
      rooms[targetRoomId].status = 'waiting';
      if (rooms[targetRoomId].timerInterval) clearInterval(rooms[targetRoomId].timerInterval);
      io.to(targetRoomId).emit('update_students', []);
    }
  });

  socket.on('start_quiz', ({ parts, quizName, roomId }) => {
    if (!roomId) roomId = currentRoomId || 'default_room';
    const room = getOrCreateRoom(roomId);
    if (!parts || !Array.isArray(parts) || parts.length === 0) return;

    if (room.timerInterval) clearInterval(room.timerInterval);

    const queue = [];
    parts.forEach((p, pIdx) => {
      if (p.questions && Array.isArray(p.questions)) {
        p.questions.forEach((q, qIdx) => {
          queue.push({
            partTitle: p.title || `Phần ${pIdx + 1}`, partIndex: pIdx + 1, totalParts: parts.length,
            questionIndex: qIdx + 1, totalQuestionsInPart: p.questions.length, question: q
          });
        });
      }
    });

    if (queue.length === 0) return;

    room.status = 'playing';
    room.quizName = quizName || 'Bài thi';
    room.queue = queue;
    room.currentIndex = 0;
    room.essaySubmissions = [];
    
    Object.keys(room.students).forEach(id => {
      room.students[id].score = 0; room.students[id].currentScore = 0; room.students[id].answered = false;
      room.students[id].mcCorrect = 0; room.students[id].mcWrong = 0; room.students[id].mcUnanswered = 0;
      room.students[id].essayCorrect = 0; room.students[id].essayWrong = 0; room.students[id].essayUnanswered = 0;
    });

    room.currentItem = room.queue[0];
    room.phase = 'question';
    room.phaseTimeLeft = parseInt(room.currentItem.question.duration) || 10;
    room.isPaused = false;

    io.to(roomId).emit('question_started', {
      item: room.currentItem,
      duration: room.phaseTimeLeft,
      currentIndex: room.currentIndex,
      totalQuestions: room.queue.length
    });

    startRoomTimer(roomId);
  });

  // TÍNH NĂNG TẠM DỪNG MỚI
  socket.on('toggle_pause', ({ roomId }) => {
    const targetRoomId = roomId || currentRoomId;
    if (targetRoomId && rooms[targetRoomId] && rooms[targetRoomId].status === 'playing') {
      const room = rooms[targetRoomId];
      room.isPaused = !room.isPaused;
      if (room.isPaused) {
        io.to(targetRoomId).emit('quiz_paused');
      } else {
        io.to(targetRoomId).emit('quiz_resumed');
      }
    }
  });

  socket.on('submit_answer', ({ isCorrect, remainingTime, roomId, type, answerText, questionTitle, teacherAnswers }) => {
    const targetRoomId = roomId || currentRoomId;
    if (targetRoomId && rooms[targetRoomId] && rooms[targetRoomId].status === 'playing') {
      const room = rooms[targetRoomId];
      if (room.students[socket.id]) {
        const student = room.students[socket.id];
        if (!student.answered) {
          student.answered = true;
          const secondsLeft = Math.max(1, parseInt(remainingTime) || 0);
          student.currentScore = isCorrect ? secondsLeft : 0;

          if (type === 'short_answer') {
            room.essaySubmissions.push({
              studentId: socket.id, studentName: student.name, mascot: student.mascot,
              questionTitle: questionTitle, teacherAnswers: teacherAnswers || '',
              answerText: answerText || '(Trống)', isCorrect: isCorrect, potentialPoints: secondsLeft
            });
          }
        }
      }
    }
  });

  socket.on('override_essay', ({ roomId, studentId, points }) => {
    const targetRoomId = roomId || currentRoomId;
    if (targetRoomId && rooms[targetRoomId]) {
      const room = rooms[targetRoomId];
      if (room.students[studentId]) {
        const addedScore = parseInt(points) || 0;
        room.students[studentId].score += addedScore;
        room.students[studentId].essayCorrect = (room.students[studentId].essayCorrect || 0) + 1;
        room.students[studentId].essayWrong = Math.max(0, (room.students[studentId].essayWrong || 0) - 1);
      }
    }
  });

  socket.on('reveal_results', ({ roomId }) => {
    const targetRoomId = roomId || currentRoomId;
    if (targetRoomId && rooms[targetRoomId]) {
      io.to(targetRoomId).emit('results_revealed', {
        leaderboard: Object.values(rooms[targetRoomId].students),
        quizName: rooms[targetRoomId].quizName
      });
    }
  });

  socket.on('disconnect', () => {});
});

server.listen(PORT, () => {
  console.log(`Server listening on PORT: ${PORT}`);
});
