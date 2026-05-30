# WebRTC 信令服务器

这是一个基于 Node.js + Socket.IO 的 WebRTC 信令服务器项目。

## 安装依赖

```bash
npm install
```

## 启动服务器

```bash
npm start
```

服务器将在 `http://localhost:3000` 运行。

## 使用方法

1. 启动服务器后，在浏览器中打开 `http://localhost:3000`
2. 在多个浏览器标签页或不同浏览器中打开该地址
3. 每个客户端会自动连接到信令服务器并获得唯一 ID
4. 在用户列表中选择要通话的用户
5. 点击"📞 呼叫选中用户"按钮发起通话
6. 连接建立后即可通过数据通道进行聊天

## 功能特性

- ✅ 自动信令交换（无需手动复制粘贴）
- ✅ 实时用户列表
- ✅ P2P 数据通道聊天
- ✅ 连接状态实时显示
- ✅ 支持多用户同时在线

## 技术栈

- **后端**: Node.js + Express + Socket.IO
- **前端**: 原生 JavaScript + WebRTC API
- **信令**: WebSocket (Socket.IO)
