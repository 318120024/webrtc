const https = require('https');
const http = require('http');

// 测试PeerJS信令服务器列表
const peerServers = [
  { name: 'PeerJS 官方 (0.peerjs.com)', host: '0.peerjs.com', port: 443, path: '/peerjs/id', secure: true },
  { name: 'PeerJS 官方 (peerjs.com)', host: 'peerjs.com', port: 443, path: '/peerjs/id', secure: true },
];

// 测试单个PeerJS服务器
function testPeerServer(server) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const client = server.secure ? https : http;

    const options = {
      hostname: server.host,
      port: server.port,
      path: server.path,
      method: 'GET',
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    };

    const req = client.request(options, (res) => {
      const responseTime = Date.now() - startTime;
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve({
          ...server,
          success: res.statusCode === 200,
          statusCode: res.statusCode,
          responseTime,
          error: res.statusCode !== 200 ? `HTTP ${res.statusCode}` : null
        });
      });
    });

    req.on('error', (err) => {
      const responseTime = Date.now() - startTime;
      resolve({
        ...server,
        success: false,
        statusCode: null,
        responseTime,
        error: err.message
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        ...server,
        success: false,
        statusCode: null,
        responseTime: 5000,
        error: '超时'
      });
    });

    req.end();
  });
}

// 测试WebSocket连接
function testWebSocket(server) {
  return new Promise((resolve) => {
    console.log(`\n测试 WebSocket 连接到 ${server.name}...`);

    // 简单测试：尝试建立TCP连接
    const net = require('net');
    const startTime = Date.now();
    const socket = new net.Socket();

    socket.setTimeout(5000);

    socket.connect(server.port, server.host, () => {
      const responseTime = Date.now() - startTime;
      console.log(`✅ TCP连接成功 (${responseTime}ms)`);
      socket.destroy();
      resolve({ success: true, responseTime });
    });

    socket.on('error', (err) => {
      console.log(`❌ TCP连接失败: ${err.message}`);
      resolve({ success: false, error: err.message });
    });

    socket.on('timeout', () => {
      console.log(`❌ TCP连接超时`);
      socket.destroy();
      resolve({ success: false, error: '超时' });
    });
  });
}

// 测试所有服务器
async function testAllServers() {
  console.log('开始测试 PeerJS 信令服务器...\n');
  console.log('=' .repeat(70));

  for (const server of peerServers) {
    process.stdout.write(`\n测试 ${server.name}... `);
    const result = await testPeerServer(server);

    if (result.success) {
      console.log(`✅ 成功 (${result.responseTime}ms, HTTP ${result.statusCode})`);
    } else {
      console.log(`❌ 失败 (${result.error})`);
    }

    // 测试WebSocket连接
    await testWebSocket(server);
  }

  console.log('\n' + '=' .repeat(70));
  console.log('\n💡 诊断结果:\n');
  console.log('如果以上测试都失败，说明无法访问 PeerJS 官方服务器。');
  console.log('可能的原因：');
  console.log('  1. 网络防火墙阻止了连接');
  console.log('  2. 需要使用代理');
  console.log('  3. PeerJS 官方服务器在你的地区不可用');
  console.log('\n解决方案：');
  console.log('  1. 搭建自己的 PeerJS 服务器');
  console.log('  2. 使用其他 WebRTC 方案（如 Socket.io + simple-peer）');
  console.log('  3. 使用云服务商的 WebRTC 服务（腾讯云TRTC、阿里云RTC等）');
}

testAllServers().catch(console.error);
