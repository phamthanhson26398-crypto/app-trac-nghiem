const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

// Bộ lưu trữ dữ liệu tập trung
const state = {
  status: 'waiting', // waiting | playing | ended
  quizName: '',
  queue: [],
  currentIndex: 0,
  currentEndTime: 0,
  students: {},
  loopInterval: null
};

io.on('connection', (socket) => {
  // Gửi trạng thái hiện tại ngay khi kết nối lại
  socket.on('join_room', ({ name, role }) => {
    if (role === 'student') {
      if (!state.students[socket.id]) {
        state.students[socket.id] = {
          id: socket.id,
          name: name || 'Thí sinh',
          score: 0,
          currentScore: 0,
          answered: false
        };
      }
      io.emit('update_students', Object.values(state.students));
    }
  });

  socket.on('start_quiz', ({ parts, quizName }) => {
    if (!parts || parts.length === 0) return;

    // Dọn dẹp vòng lặp cũ
    if (state.loopInterval) {
      clearInterval(state.loopInterval);
      state.loopInterval = null;
    }

    // Nén đề thi thành danh sách câu hỏi tuần tự
    const queue = [];
    parts.forEach((p, pIdx) => {
      p.questions.forEach((q, qIdx) => {
        queue.push({
          partTitle: p.title,
          partIndex: pIdx + 1,
          totalParts: parts.length,
          questionIndex: qIdx + 1,
          totalQuestionsInPart: p.questions.length,
          question: q
        });
      });
    });

    state.status = 'playing';
    state.quizName = quizName || 'Bài thi';
    state.queue = queue;
    state.currentIndex = 0;

    // Reset điểm toàn bộ học sinh
    Object.keys(state.students).forEach(id => {
      state.students[id].score = 0;
      state.students[id].currentScore = 0;
      state.students[id].answered = false;
    });

    function dispatchQuestion() {
      if (state.currentIndex >= state.queue.length) {
        state.status = 'ended';
        if (state.loopInterval) clearInterval(state.loopInterval);
        io.emit('quiz_ended', { 
          leaderboard: Object.values(state.students), 
          quizName: state.quizName 
        });
        return;
      }

      const currentItem = state.queue[state.currentIndex];
      const duration = parseInt(currentItem.question.duration) || 10;
      state.currentEndTime = Date.now() + (duration * 1000);

      // Reset lượt làm câu hiện tại
      Object.keys(state.students).forEach(id => {
        state.students[id].currentScore = 0;
        state.students[id].answered = false;
      });

      // Bắn câu hỏi mới kèm thời gian kết thúc chuẩn xác
      io.emit('question_started', {
        item: currentItem,
        duration: duration,
        endTime: state.currentEndTime,
        itemIndex: state.currentIndex
      });
    }

    // Phát câu đầu tiên
    dispatchQuestion();

    // VÒNG LẶP ĐIỀU PHỐI TRUNG TÂM (Chạy liên tục mỗi 500ms để kiểm tra mốc chuyển câu)
    state.loopInterval = setInterval(() => {
      if (state.status !== 'playing') return;

      const now = Date.now();
      // Khi đã vượt quá mốc kết thúc câu hỏi (+ 1.5s độ trễ mạng)
      if (now >= state.currentEndTime + 1500) {
        // Cộng dồn điểm của câu vừa xong
        Object.keys(state.students).forEach(id => {
          state.students[id].score += state.students[id].currentScore;
          state.students[id].currentScore = 0;
        });

        // Nhảy sang câu tiếp theo
        state.currentIndex++;
        dispatchQuestion();
      }
    }, 500);
  });

  // Nhận kết quả nộp bài
  socket.on('submit_answer', ({ isCorrect, remainingTime }) => {
    if (state.status === 'playing' && state.students[socket.id]) {
      const student = state.students[socket.id];
      if (!student.answered) {
        student.answered = true;
        student.currentScore = isCorrect ? Math.max(1, parseInt(remainingTime) || 0) : 0;
      }
    }
  });

  socket.on('disconnect', () => {});
});

server.listen(PORT, () => {
  console.log(`Server is running on PORT: ${PORT}`);
});
