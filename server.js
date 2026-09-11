const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. KẾT NỐI MONGODB ATLAS VỚI TÊN DATABASE "tntt_db"
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://buntony11_db_user:Son123456789@tnttcluster.hrxeeyz.mongodb.net/tntt_db?retryWrites=true&w=majority&appName=TNTTCluster';

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 10000
})
.then(() => {
  console.log('✅ Đã kết nối thành công với MongoDB Atlas!');
})
.catch(err => {
  console.error('❌ Lỗi kết nối MongoDB:', err);
});

// 2. KHAI BÁO MODEL TEACHER
const teacherSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  quizzes: { type: Object, default: {} }
});
const Teacher = mongoose.model('Teacher', teacherSchema);

app.get('/api/teachers', async (req, res) => {
  try {
    const list = await Teacher.find({}, { username: 1, password: 1, _id: 0 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. QUẢN LÝ PHÒNG THI VÀ TRÒ CHƠI TRỰC TUYẾN
const rooms = {};

const ANIMAL_MASCOTS = [
  { name: 'Sư Tử', icon: '🦁' },
  { name: 'Hổ', icon: '🐯' },
  { name: 'Gấu', icon: '🐻' },
  { name: 'Thỏ', icon: '🐰' },
  { name: 'Gấu Koala', icon: '🐨' },
  { name: 'Cáo', icon: '🦊' },
  { name: 'Gấu Trúc', icon: '🐼' },
  { name: 'Khuê', icon: '🦄' }
];

io.on('connection', (socket) => {
  const deviceToken = socket.handshake.query.deviceToken;

  socket.on('teacher_login', async ({ username, password }) => {
    try {
      const cleanUser = (username || '').trim();
      const cleanPass = (password || '').trim();
      const teacher = await Teacher.findOne({ username: cleanUser });
      
      if (teacher && teacher.password === cleanPass) {
        socket.emit('auth_response', { success: true, username: cleanUser });
      } else {
        socket.emit('auth_response', { success: false, message: 'Sai tên tài khoản hoặc mật khẩu!' });
      }
    } catch (err) {
      console.error("Lỗi đăng nhập:", err);
      socket.emit('auth_response', { success: false, message: 'Lỗi đăng nhập server!' });
    }
  });

  socket.on('admin_create_user', async ({ username, password }) => {
    try {
      const cleanUser = (username || '').trim();
      const cleanPass = (password || '').trim();
      if (!cleanUser || !cleanPass) return;
      
      const existing = await Teacher.findOne({ username: cleanUser });
      if (!existing) {
        await Teacher.create({ username: cleanUser, password: cleanPass, quizzes: {} });
      }
      const list = await Teacher.find({}, { username: 1, password: 1, _id: 0 });
      io.emit('admin_user_list_update', list);
    } catch (err) {
      console.error("Lỗi tạo tài khoản:", err);
    }
  });

  socket.on('admin_get_users', async () => {
    try {
      const list = await Teacher.find({}, { username: 1, password: 1, _id: 0 });
      socket.emit('admin_user_list_update', list);
    } catch (err) {
      console.error("Lỗi lấy danh sách:", err);
    }
  });

  socket.on('admin_reset_pass', async ({ username, newPass }) => {
    try {
      await Teacher.findOneAndUpdate({ username }, { password: newPass });
      const list = await Teacher.find({}, { username: 1, password: 1, _id: 0 });
      io.emit('admin_user_list_update', list);
    } catch (err) {
      console.error("Lỗi đổi mật khẩu:", err);
    }
  });

  socket.on('admin_delete_user', async ({ username }) => {
    try {
      await Teacher.findOneAndDelete({ username });
      const list = await Teacher.find({}, { username: 1, password: 1, _id: 0 });
      io.emit('admin_user_list_update', list);
    } catch (err) {
      console.error("Lỗi xóa tài khoản:", err);
    }
  });

  socket.on('get_teacher_quizzes', async ({ username }) => {
    try {
      const teacher = await Teacher.findOne({ username });
      if (teacher) {
        socket.emit('teacher_quizzes_loaded', { quizzes: teacher.quizzes || {} });
      }
    } catch (err) {
      console.error("Lỗi tải kho bài thi:", err);
    }
  });

  socket.on('save_teacher_quizzes', async ({ username, quizzes }) => {
    try {
      await Teacher.findOneAndUpdate({ username }, { quizzes });
      socket.emit('save_quizzes_success', { success: true });
    } catch (err) {
      console.error("Lỗi lưu kho bài thi:", err);
    }
  });

  socket.on('join_room', ({ role, roomId, name }) => {
    if (!roomId) return;
    socket.join(roomId);
    socket.roomId = roomId;
    socket.role = role;

    if (!rooms[roomId]) {
      rooms[roomId] = { 
        students: [], 
        quizActive: false, 
        currentPartIdx: 0, 
        currentQIdx: 0, 
        timer: null, 
        nextQTimeout: null,
        currentRemainingSeconds: 0,
        isPaused: false,
        scores: {}, 
        answersState: {} 
      };
    }

    if (role === 'student') {
      const room = rooms[roomId];
      
      // 👉 Kiểm tra xem máy này (deviceToken) đã có trong phòng chưa
      let existing = room.students.find(s => s.deviceToken === deviceToken);
      let mascot;

      if (existing) {
        // Nếu đã tồn tại, GIỮ NGUYÊN linh vật cũ và cập nhật socket.id mới
        existing.id = socket.id;
        if (name) existing.name = name;
        mascot = existing.mascot;
        
        // Cập nhật luôn socket.id trong bảng điểm (scores) nếu đã tồn tại điểm trước đó
        if (room.scores[existing.id] || room.scores[socket.id]) {
          // Gộp dữ liệu điểm nếu cần thiết
        }
      } else {
        // Nếu chưa có, tạo mới linh vật và thêm vào danh sách
        mascot = ANIMAL_MASCOTS[Math.floor(Math.random() * ANIMAL_MASCOTS.length)];
        room.students.push({ 
          id: socket.id, 
          name: name || 'Thí sinh', 
          mascot: mascot, 
          deviceToken: deviceToken 
        });
      }

      socket.emit('my_mascot_assigned', mascot);
      io.to(roomId).emit('update_students', room.students);

      // Nếu phòng đang thi, gửi trạng thái câu hỏi hiện tại cho học sinh F5
      if (room.quizActive && room.currentItem) {
        const q = room.currentItem.question;
        const alreadySubmitted = !!room.answersState[deviceToken];

        socket.emit('question_started', {
          item: room.currentItem,
          duration: room.currentRemainingSeconds || q.duration || 15,
          currentIndex: room.currentItem.qIdx,
          totalQuestions: room.quizParts[room.currentItem.partIdx].questions.length,
          alreadySubmitted: alreadySubmitted
        });
      }
    }
  });

  socket.on('clear_room_students', ({ roomId }) => {
    if (rooms[roomId]) {
      rooms[roomId].students = [];
      io.to(roomId).emit('update_students', []);
    }
  });

  socket.on('kick_student', ({ studentId, roomId }) => {
    if (rooms[roomId]) {
      rooms[roomId].students = rooms[roomId].students.filter(s => s.id !== studentId);
      io.to(roomId).emit('update_students', rooms[roomId].students);
      io.to(studentId).emit('kicked_by_teacher');
    }
  });

  socket.on('start_quiz', ({ parts, quizName, roomId }) => {
    if (!rooms[roomId]) return;
    const room = rooms[roomId];
    room.quizParts = parts;
    room.quizName = quizName;
    room.quizActive = true;
    room.isPaused = false;
    room.currentPartIdx = 0;
    room.currentQIdx = 0;
    room.scores = {};
    room.roomMaxScore = parts.reduce((acc, p) => acc + (p.maxScore || 10), 0);

    // 👉 Dùng deviceToken làm khóa chính để không bị nhân bản học sinh khi tính điểm
    room.students.forEach(s => {
      room.scores[s.deviceToken] = { 
        id: s.id, 
        deviceToken: s.deviceToken, 
        name: s.name, 
        mascot: s.mascot, 
        score: 0, 
        mcCorrect: 0, 
        mcWrong: 0, 
        essayCorrect: 0, 
        essayWrong: 0, 
        skipped: 0 
      };
    });

    runNextQuestion(roomId);
  });

  function runNextQuestion(roomId) {
    const room = rooms[roomId];
    if (!room || !room.quizActive) return;

    if (room.timer) { clearInterval(room.timer); room.timer = null; }
    if (room.nextQTimeout) { clearTimeout(room.nextQTimeout); room.nextQTimeout = null; }
    room.isPaused = false;

    const currentPart = room.quizParts[room.currentPartIdx];
    if (!currentPart || room.currentQIdx >= currentPart.questions.length) {
      room.currentPartIdx++;
      room.currentQIdx = 0;
      if (room.currentPartIdx >= room.quizParts.length) {
        room.quizActive = false;
        const leaderboard = Object.values(room.scores);
        
        let allQuestionsList = [];
        room.quizParts.forEach((part) => {
          part.questions.forEach((qu, qIdx) => {
            allQuestionsList.push({
              partTitle: part.title,
              questionIndex: qIdx + 1,
              question: qu
            });
          });
        });

        io.to(roomId).emit('quiz_ended', { quizName: room.quizName, leaderboard, allQuestions: allQuestionsList });
        return;
      }
      return runNextQuestion(roomId);
    }

    const q = currentPart.questions[room.currentQIdx];
    
    // 🌟 Chuẩn hóa toàn diện đáp án đúng cho cả Trắc nghiệm lẫn Đúng/Sai
    let formattedQuestion = JSON.parse(JSON.stringify(q));
    if (formattedQuestion.type === 'multiple' && formattedQuestion.correct !== undefined) {
      const c = String(formattedQuestion.correct).trim().toUpperCase();
      if (c === 'A' || c === '0') formattedQuestion.correct = 0;
      else if (c === 'B' || c === '1') formattedQuestion.correct = 1;
      else if (c === 'C' || c === '2') formattedQuestion.correct = 2;
      else if (c === 'D' || c === '3') formattedQuestion.correct = 3;
      else formattedQuestion.correct = parseInt(formattedQuestion.correct, 10) || 0;
    } else if (formattedQuestion.type === 'tf' && formattedQuestion.correct !== undefined) {
      const c = String(formattedQuestion.correct).trim().toLowerCase();
      if (c === 'đúng' || c === 'true' || c === '1' || c === 'dung') formattedQuestion.correct = 'Đúng';
      else formattedQuestion.correct = 'Sai';
    }

    room.currentItem = { 
      partIdx: room.currentPartIdx, 
      partTitle: currentPart.title,
      qIdx: room.currentQIdx, 
      questionIndex: room.currentQIdx + 1,
      totalQuestionsInPart: currentPart.questions.length,
      question: formattedQuestion 
    };
    room.answersState = {}; 
    room.currentRemainingSeconds = q.duration || 15;

    io.to(roomId).emit('question_started', {
      item: room.currentItem,
      duration: room.currentRemainingSeconds,
      currentIndex: room.currentQIdx,
      totalQuestions: currentPart.questions.length
    });

    startQuestionTimer(roomId);
  }

  function startQuestionTimer(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    if (room.timer) clearInterval(room.timer);

    room.timer = setInterval(() => {
      if (room.isPaused) return;

      room.currentRemainingSeconds--;
      
      // Nếu hết thời gian làm bài của câu hỏi hiện tại
      if (room.currentRemainingSeconds <= 0) {
        clearInterval(room.timer);
        room.timer = null;
        io.to(roomId).emit('question_time_up');

        // Bắt đầu đếm 10 giây nghỉ giữa câu
        room.currentRemainingSeconds = 10; 
        startRestTimer(roomId);
      }
    }, 1000);
  }

  // 🌟 HÀM ĐẾM THỜI GIAN NGHỈ 10 GIÂY (GIỮ NGUYÊN SỐ GIÂY, KHÔNG BAO GIỜ BỊ RESET KHI TẠM DỪNG)
  function startRestTimer(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    if (room.timer) clearInterval(room.timer);

    room.timer = setInterval(() => {
      if (room.isPaused) return;

      room.currentRemainingSeconds--;

      // Nếu đếm ngược hết 10 giây nghỉ -> Tự động sang câu tiếp theo
      if (room.currentRemainingSeconds <= 0) {
        clearInterval(room.timer);
        room.timer = null;
        room.currentQIdx++;
        runNextQuestion(roomId);
      }
    }, 1000);
  }

  // 👉 SỰ KIỆN TẠM DỪNG & TIẾP TỤC ĐẢM BẢO GIỮ NGUYÊN TIẾN TRÌNH THỜI GIAN
  socket.on('toggle_pause', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.quizActive) return;

    if (!room.isPaused) {
      // 🛑 BẤM TẠM DỪNG: Đóng băng hoàn toàn tiến trình đếm ngược hiện tại
      room.isPaused = true;
      if (room.timer) { clearInterval(room.timer); room.timer = null; }
      if (room.nextQTimeout) { clearTimeout(room.nextQTimeout); room.nextQTimeout = null; }

      let essaySubmissionsForCurrent = [];
      if (room.currentItem && room.currentItem.question.type === 'short_answer') {
        const qMaxScore = room.quizParts[room.currentItem.partIdx].maxScore || 10;
        const qCount = room.quizParts[room.currentItem.partIdx].questions.length;
        const ptsPerQ = qMaxScore / qCount;

        Object.values(room.answersState).forEach(ans => {
          if (!ans.isCorrect && ans.type === 'short_answer') {
            essaySubmissionsForCurrent.push({
              studentId: ans.studentId,
              studentName: ans.studentName,
              mascot: ans.mascot,
              answerText: ans.answerText,
              potentialPoints: ptsPerQ
            });
          }
        });
      }

      io.to(roomId).emit('timer_paused');
      io.to(roomId).emit('quiz_paused', { essaySubmissionsForCurrent });
    } else {
      // ▶️ BẤM TIẾP TỤC: Phục hồi lại đúng trạng thái trước khi dừng (Đang làm bài hay đang nghỉ 10s)
      room.isPaused = false;
      io.to(roomId).emit('timer_resumed');
      io.to(roomId).emit('quiz_resumed');

      // Nếu đang trong thời gian nghỉ 10 giây mà bị bấm tạm dừng thì gọi tiếp hàm nghỉ, ngược lại gọi hàm làm bài
      if (room.currentRemainingSeconds <= 10 && room.timer === null && room.currentItem && room.currentRemainingSeconds > 0) {
        // Kiểm tra xem đang ở giai đoạn nghỉ hay đang làm bài dựa vào khoảng thời gian
        startRestTimer(roomId);
      } else {
        startQuestionTimer(roomId);
      }
    }
  });

  socket.on('submit_answer', ({ isCorrect, remainingTime, roomId, type, answerText, questionTitle, teacherAnswers, selectedIndex }) => {
    const room = rooms[roomId];
    if (!room || !room.quizActive) return;

    const student = room.students.find(s => s.id === socket.id);
    if (!student) return;

    const currentPart = room.quizParts[room.currentItem.partIdx];
    const ptsPerQ = (currentPart.maxScore || 10) / currentPart.questions.length;
    const earnedPoints = isCorrect ? ptsPerQ : 0;

    // 🌟 Khởi tạo cấu trúc điểm và lịch sử bài làm chuẩn gốc nếu chưa có
    if (!room.scores[student.deviceToken]) {
      room.scores[student.deviceToken] = { 
        id: student.id, 
        deviceToken: student.deviceToken, 
        name: student.name, 
        mascot: student.mascot, 
        score: 0, 
        mcCorrect: 0, 
        mcWrong: 0, 
        mcUnanswered: 0,
        essayCorrect: 0, 
        essayWrong: 0, 
        essayUnanswered: 0,
        skipped: 0,
        answerHistory: [] 
      };
    }

    const studentScoreObj = room.scores[student.deviceToken];

    // 👉 Lưu chi tiết lịch sử trả lời của từng câu hỏi để học sinh xem lại
    const qIndex = room.currentItem.qIdx;
    const existingAnsIndex = studentScoreObj.answerHistory.findIndex(h => h.questionIndex === qIndex);
    
    const historyItem = {
      questionIndex: qIndex,
      type: type,
      userAnswer: answerText,
      selectedIndex: selectedIndex !== undefined ? selectedIndex : null,
      isCorrect: isCorrect,
      points: earnedPoints,
      isOverridden: false
    };

    if (existingAnsIndex >= 0) {
      studentScoreObj.answerHistory[existingAnsIndex] = historyItem;
    } else {
      studentScoreObj.answerHistory.push(historyItem);
    }

    // Lưu trạng thái nộp bài để chống F5 nộp lại nhiều lần
    room.answersState[student.deviceToken] = {
      studentId: socket.id,
      studentName: student.name,
      mascot: student.mascot,
      isCorrect: isCorrect,
      type: type,
      answerText: answerText
    };

    // Tính toán điểm số và số câu đúng/sai
    if (answerText === '' || answerText === null) {
      studentScoreObj.skipped++;
    } else if (isCorrect) {
      if (type === 'short_answer') studentScoreObj.essayCorrect++;
      else studentScoreObj.mcCorrect++;
      studentScoreObj.score = parseFloat((studentScoreObj.score + ptsPerQ).toFixed(1));
    } else {
      if (type === 'short_answer') studentScoreObj.essayWrong++;
      else studentScoreObj.mcWrong++;
    }
  });

  socket.on('override_essay_live', ({ roomId, studentId, points }) => {
    const room = rooms[roomId];
    if (!room || !room.scores[studentId]) return;
    room.scores[studentId].essayCorrect++;
    room.scores[studentId].essayWrong = Math.max(0, room.scores[studentId].essayWrong - 1);
    room.scores[studentId].score = parseFloat((room.scores[studentId].score + points).toFixed(1));
  });

  socket.on('reveal_results', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const leaderboard = Object.values(room.scores);
    
    let allQuestionsList = [];
    if (room.quizParts) {
      room.quizParts.forEach((part) => {
        part.questions.forEach((qu, qIdx) => {
          allQuestionsList.push({
            partTitle: part.title,
            questionIndex: qIdx + 1,
            question: qu
          });
        });
      });
    }

    io.to(roomId).emit('results_revealed', { leaderboard, quizName: room.quizName, allQuestions: allQuestionsList });
  });

  socket.on('disconnect', () => {
    for (let roomId in rooms) {
      const room = rooms[roomId];
      room.students = room.students.filter(s => s.id !== socket.id);
      io.to(roomId).emit('update_students', room.students);
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Server đang chạy trên cổng ${PORT}`);
});
