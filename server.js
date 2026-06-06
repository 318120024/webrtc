const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
app.use(express.static(__dirname));

// 静态文件服务
app.use(express.static(__dirname));

// 存储在线用户
const users = new Map();

io.on('connection', (socket) => {
  console.log('新用户连接:', socket.id);

  // 用户加入
  socket.on('join', () => {
    users.set(socket.id, socket);
    console.log('当前在线用户数:', users.size);

    // 通知所有用户更新用户列表
    io.emit('users', Array.from(users.keys()));
  });

  // 转发 offer
  socket.on('offer', (data) => {
    console.log('转发 offer 从', socket.id, '到', data.target);
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  // 转发 answer
  socket.on('answer', (data) => {
    console.log('转发 answer 从', socket.id, '到', data.target);
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  // 转发 ICE 候选
  socket.on('ice-candidate', (data) => {
    console.log('转发 ICE 候选从', socket.id, '到', data.target);
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  // 用户断开连接
  socket.on('disconnect', () => {
    console.log('用户断开连接:', socket.id);
    users.delete(socket.id);
    io.emit('users', Array.from(users.keys()));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`信令服务器运行在 http://localhost:${PORT}`);
});
