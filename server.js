const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');

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

// 👉 KẾT NỐI MONGODB ATLAS VĨNH VIỄN
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://buntony11_db_user:Son.01655850906@tnttcluster.hrxeeyz.mongodb.net/?retryWrites=true&w=majority&appName=TNTTCluster';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Đã kết nối thành công với MongoDB Atlas!');
}).catch(err => {
  console.error('❌ Lỗi kết nối MongoDB:', err);
});

// Định nghĩa cấu trúc lưu tài khoản trên Database
const teacherSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});
const Teacher = mongoose.model('Teacher', teacherSchema);

// Hàm phụ trợ lấy toàn bộ danh sách giáo viên dạng object { username: password }
async function loadTeachersDB() {
  try {
    const list = await Teacher.find({});
    const db = {};
    list.forEach(t => {
      db[t.username] = t.password;
    });
    return db;
  } catch (err) {
    console.error("Lỗi đọc database giáo viên:", err);
    return {};
  }
}

const MASCOTS = [
  { icon: '🦁', title: 'Sư Tử Dũng Mãnh' }, { icon: '🐯', title: 'Hổ Con Nhanh Nhẹn' },
  { icon: '🦊', title: 'Cáo Thông Thái' }, { icon: '🐼', title: 'Gấu Trúc Cute' },
  { icon: '🦄', title: 'Kỳ Lân Phép Thuật' }, { icon: '🐬', title: 'Cá Heo Thân Thiện' },
  { icon: '🦅', title: 'Đại Bàng Tinh Anh' }, { icon: '🐲', title: 'Rồng Lửa Uy Lực' },
  { icon: '🐨', title: 'Koala Hiền Lành' }, { icon: '🦉', title: 'Cú Mèo Tri Thức' },
  { icon: '🐺', title: 'Sói Đầu Đàn' }, { icon: '🦖', title: 'Khủng Long Bạo Chúa' },
  { icon: '🚀', title: 'Phi Hành Gia' }, { icon: '⚡', title: 'Tia Chớp Thần Tốc' },
  { icon: '🌟', title: 'Ngôi Sao May Mắn' }, { icon: '🦹', title: 'Siêu Anh Hùng' }
];

const rooms = {};

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      status: 'waiting', quizName: '', queue: [], currentIndex: 0, currentItem: null,
      students: {}, timerInterval: null, phase: 'question', phaseTimeLeft: 0, isPaused: false
    };
  }
  return rooms[roomId];
}

function startRoomTimer(roomId) {
  const room = rooms[roomId];
  if (room.timerInterval) clearInterval(room.timerInterval);

  room.timerInterval = setInterval(() => {
    if (room.isPaused) return;

    room.phaseTimeLeft--;

    if (room.phaseTimeLeft <= 0) {
      if (room.phase === 'question') {
        room.phase = 'transition';
        room.phaseTimeLeft = 10; 
        io.to(roomId).emit('question_time_up');

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
        room.currentIndex++;
        if (room.currentIndex >= room.queue.length) {
          clearInterval(room.timerInterval);
          room.status = 'ended';
          io.to(roomId).emit('quiz_ended', { 
            quizName: room.quizName,
            leaderboard: Object.values(room.students),
            allQuestions: room.queue
          });
        } else {
          room.phase = 'question';
          room.currentItem = room.queue[room.currentIndex];
          room.phaseTimeLeft = parseInt(room.currentItem.question.duration) || 15;
          
          Object.keys(room.students).forEach(id => {
            room.students[id].answered = false;
          });

          io.to(roomId).emit('question_started', {
            item: room.currentItem, duration: room.phaseTimeLeft,
            currentIndex: room.currentIndex, totalQuestions: room.queue.length
          });
        }
      }
    }
  }, 1000);
}

io.on('connection', (socket) => {
  let currentRoomId = null;
  const clientDeviceToken = socket.handshake.query.deviceToken;

  socket.on('teacher_register', async ({ username, password }) => {
    if (!username || !password) return socket.emit('auth_response', { success: false, message: 'Vui lòng điền đủ thông tin!' });
    try {
      const existing = await Teacher.findOne({ username });
      if (existing) return socket.emit('auth_response', { success: false, message: 'Tên tài khoản này đã tồn tại!' });
      
      const newTeacher = new Teacher({ username, password });
      await newTeacher.save();
      
      socket.emit('auth_response', { success: true, isRegister: true, message: 'Đăng ký thành công!' });
      const updatedDB = await loadTeachersDB();
      io.emit('admin_user_list_update', updatedDB);
    } catch (err) {
      console.error(err);
      socket.emit('auth_response', { success: false, message: 'Lỗi server khi đăng ký!' });
    }
  });

  socket.on('teacher_login', async ({ username, password }) => {
    try {
      const teacher = await Teacher.findOne({ username });
      if (teacher && teacher.password === password) {
        socket.emit('auth_response', { success: true, isRegister: false, username: username });
      } else {
        socket.emit('auth_response', { success: false, message: 'Sai tên tài khoản hoặc mật khẩu!' });
      }
    } catch (err) {
      console.error(err);
      socket.emit('auth_response', { success: false, message: 'Lỗi đăng nhập!' });
    }
  });

  socket.on('admin_get_users', async () => { 
    const updatedDB = await loadTeachersDB();
    socket.emit('admin_user_list_update', updatedDB); 
  });

  socket.on('admin_reset_pass', async ({ username, newPass }) => {
    try {
      await Teacher.updateOne({ username }, { password: newPass });
      const updatedDB = await loadTeachersDB();
      io.emit('admin_user_list_update', updatedDB);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('admin_delete_user', async ({ username }) => {
    try {
      await Teacher.deleteOne({ username });
      const updatedDB = await loadTeachersDB();
      io.emit('admin_user_list_update', updatedDB);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('join_room', ({ name, role, roomId, deviceToken }) => {
    if (!roomId) roomId = 'default_room';
    currentRoomId = roomId;
    socket.join(roomId);
    const room = getOrCreateRoom(roomId);
    const tokenToUse = deviceToken || clientDeviceToken;

    if (role === 'student') {
      let existingKey = null;
      if (tokenToUse) {
        existingKey = Object.keys(room.students).find(id => room.students[id].deviceToken === tokenToUse);
      }

      if (existingKey) {
        room.students[socket.id] = room.students[existingKey];
        room.students[socket.id].id = socket.id;
        if (existingKey !== socket.id) delete room.students[existingKey];
      } else {
        const randomMascot = MASCOTS[Math.floor(Math.random() * MASCOTS.length)];
        room.students[socket.id] = {
          id: socket.id, name: name || 'Đoàn sinh', mascot: randomMascot, deviceToken: tokenToUse,
          score: 0, currentScore: 0, answered: false, mcCorrect: 0, mcWrong: 0, mcUnanswered: 0, 
          essayCorrect: 0, essayWrong: 0, essayUnanswered: 0, answerHistory: []
        };
      }

      socket.emit('my_mascot_assigned', room.students[socket.id].mascot);
      io.to(roomId).emit('update_students', Object.values(room.students));

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
            questionIndex: qIdx + 1, totalQuestionsInPart: p.questions.length, 
            maxScore: p.maxScore || 10,
            question: q
          });
        });
      }
    });

    if (queue.length === 0) return;

    room.status = 'playing';
    room.quizName = quizName || 'Bài thi';
    room.queue = queue;
    room.currentIndex = 0;
    
    Object.keys(room.students).forEach(id => {
      room.students[id].score = 0; room.students[id].currentScore = 0; room.students[id].answered = false;
      room.students[id].mcCorrect = 0; room.students[id].mcWrong = 0; room.students[id].mcUnanswered = 0;
      room.students[id].essayCorrect = 0; room.students[id].essayWrong = 0; room.students[id].essayUnanswered = 0;
      room.students[id].answerHistory = [];
    });

    room.currentItem = room.queue[0];
    room.phase = 'question';
    room.phaseTimeLeft = parseInt(room.currentItem.question.duration) || 15;
    room.isPaused = false;

    io.to(roomId).emit('question_started', {
      item: room.currentItem, duration: room.phaseTimeLeft,
      currentIndex: room.currentIndex, totalQuestions: room.queue.length
    });

    startRoomTimer(roomId);
  });

  socket.on('toggle_pause', ({ roomId }) => {
    const targetRoomId = roomId || currentRoomId;
    if (targetRoomId && rooms[targetRoomId] && rooms[targetRoomId].status === 'playing') {
      const room = rooms[targetRoomId];
      room.isPaused = !room.isPaused;
      
      let essaySubmissionsForCurrent = [];
      if (room.isPaused && room.currentItem && room.currentItem.question.type === 'short_answer') {
        const correctRaw = (room.currentItem.question.correct || '').toLowerCase();
        const acceptableAnswers = correctRaw.split(/[,|]/).map(s => s.trim()).filter(Boolean);

        Object.keys(room.students).forEach(id => {
          const st = room.students[id];
          const hist = st.answerHistory.find(h => h.questionIndex === room.currentIndex);
          if (hist) {
            const userText = (hist.userAnswer || '').trim().toLowerCase();
            const isReallyCorrect = acceptableAnswers.some(ans => ans === userText);

            if (!isReallyCorrect && !hist.isOverridden) {
              essaySubmissionsForCurrent.push({
                studentId: st.id, studentName: st.name, mascot: st.mascot,
                answerText: hist.userAnswer, potentialPoints: hist.points
              });
            }
          }
        });
      }

      if (room.isPaused) io.to(targetRoomId).emit('quiz_paused', { essaySubmissionsForCurrent });
      else io.to(targetRoomId).emit('quiz_resumed');
    }
  });

  socket.on('submit_answer', ({ isCorrect, remainingTime, roomId, type, answerText, questionTitle, teacherAnswers, selectedIndex }) => {
    const targetRoomId = roomId || currentRoomId;
    if (targetRoomId && rooms[targetRoomId] && rooms[targetRoomId].status === 'playing') {
      const room = rooms[targetRoomId];
      if (room.students[socket.id]) {
        const student = room.students[socket.id];
        if (!student.answered) {
          student.answered = true;
          const secondsLeft = Math.max(1, parseInt(remainingTime) || 0);
          
          let earnedScore = 0;
          if (isCorrect && room.currentItem) {
            const totalDuration = parseInt(room.currentItem.question.duration) || 15;
            const maxScorePart = parseFloat(room.currentItem.maxScore) || 10;
            
            earnedScore = parseFloat((secondsLeft * (maxScorePart / totalDuration)).toFixed(2));
            if (earnedScore <= 0) earnedScore = 0.5;
          }

          student.currentScore = earnedScore;

          student.answerHistory.push({
            questionIndex: room.currentIndex,
            partTitle: room.currentItem.partTitle,
            questionTitle: questionTitle,
            type: type,
            isCorrect: isCorrect,
            userAnswer: answerText || '(Trống)',
            selectedIndex: selectedIndex,
            teacherAnswers: teacherAnswers || '',
            points: earnedScore,
            isOverridden: false
          });
        }
      }
    }
  });

  socket.on('override_essay_live', ({ roomId, studentId, points }) => {
    const targetRoomId = roomId || currentRoomId;
    if (targetRoomId && rooms[targetRoomId]) {
      const room = rooms[targetRoomId];
      if (room.students[studentId]) {
        const historyItem = room.students[studentId].answerHistory.find(h => h.questionIndex === room.currentIndex);
        
        if (historyItem && !historyItem.isOverridden) {
          const maxScorePart = room.currentItem ? (parseFloat(room.currentItem.maxScore) || 10) : 10;
          const earnedPoints = points ? parseFloat(points) : maxScorePart;
          
          room.students[studentId].score += earnedPoints;
          room.students[studentId].essayCorrect = (room.students[studentId].essayCorrect || 0) + 1;
          room.students[studentId].essayWrong = Math.max(0, (room.students[studentId].essayWrong || 0) - 1);
          
          historyItem.isCorrect = true;
          historyItem.isOverridden = true;
          historyItem.points = earnedPoints;
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
        allQuestions: rooms[targetRoomId].queue
      });
    }
  });

  socket.on('disconnect', () => {});
});

server.listen(PORT, () => {
  console.log(`Server listening on PORT: ${PORT}`);
});
