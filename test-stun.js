const dgram = require('dgram');
const crypto = require('crypto');

// STUN服务器列表
const stunServers = [
  { name: 'Google', host: 'stun.l.google.com', port: 19302 },
  { name: 'Google 1', host: 'stun1.l.google.com', port: 19302 },
  { name: 'Cloudflare', host: 'stun.cloudflare.com', port: 3478 },
  { name: 'OpenRelay', host: 'openrelay.metered.ca', port: 80 },
  { name: 'Mozilla', host: 'stun.services.mozilla.com', port: 3478 },
  { name: 'Twilio', host: 'global.stun.twilio.com', port: 3478 },
  { name: 'VoipStunt', host: 'stun.voipstunt.com', port: 3478 },
  { name: 'Ekiga', host: 'stun.ekiga.net', port: 3478 },
  { name: 'VoipBuster', host: 'stun.voipbuster.com', port: 3478 },
  { name: 'VoipGate', host: 'stun.voipgate.com', port: 3478 },
];

// 创建STUN绑定请求
function createStunBindingRequest() {
  const buffer = Buffer.alloc(20);
  // STUN消息类型: Binding Request (0x0001)
  buffer.writeUInt16BE(0x0001, 0);
  // 消息长度: 0 (没有属性)
  buffer.writeUInt16BE(0x0000, 2);
  // Magic Cookie: 0x2112A442
  buffer.writeUInt32BE(0x2112A442, 4);
  // Transaction ID: 96位随机数
  crypto.randomFillSync(buffer, 8, 12);
  return buffer;
}

// 测试单个STUN服务器
function testStunServer(server, timeout = 3000) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const startTime = Date.now();
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.close();
        resolve({ ...server, success: false, error: '超时', responseTime: null });
      }
    }, timeout);

    socket.on('message', (msg) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        const responseTime = Date.now() - startTime;
        socket.close();

        // 检查是否是有效的STUN响应
        const messageType = msg.readUInt16BE(0);
        const isBindingResponse = (messageType === 0x0101);

        resolve({
          ...server,
          success: isBindingResponse,
          responseTime,
          error: isBindingResponse ? null : '无效响应'
        });
      }
    });

    socket.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        socket.close();
        resolve({ ...server, success: false, error: err.message, responseTime: null });
      }
    });

    const request = createStunBindingRequest();
    socket.send(request, 0, request.length, server.port, server.host, (err) => {
      if (err && !resolved) {
        resolved = true;
        clearTimeout(timer);
        socket.close();
        resolve({ ...server, success: false, error: err.message, responseTime: null });
      }
    });
  });
}

// 测试所有服务器
async function testAllServers() {
  console.log('开始测试STUN服务器...\n');
  console.log('=' .repeat(70));

  const results = [];

  for (const server of stunServers) {
    process.stdout.write(`测试 ${server.name.padEnd(15)} (${server.host}:${server.port})... `);
    const result = await testStunServer(server);
    results.push(result);

    if (result.success) {
      console.log(`✅ 成功 (${result.responseTime}ms)`);
    } else {
      console.log(`❌ 失败 (${result.error})`);
    }
  }

  console.log('=' .repeat(70));
  console.log('\n📊 测试结果汇总:\n');

  // 按响应时间排序
  const successResults = results.filter(r => r.success).sort((a, b) => a.responseTime - b.responseTime);
  const failedResults = results.filter(r => !r.success);

  if (successResults.length > 0) {
    console.log('✅ 可用的服务器 (按速度排序):');
    successResults.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.name.padEnd(15)} - ${r.responseTime}ms - ${r.host}:${r.port}`);
    });
  }

  if (failedResults.length > 0) {
    console.log('\n❌ 不可用的服务器:');
    failedResults.forEach(r => {
      console.log(`  - ${r.name.padEnd(15)} - ${r.error} - ${r.host}:${r.port}`);
    });
  }

  if (successResults.length > 0) {
    console.log('\n💡 推荐配置 (前3个最快的):');
    console.log('iceServers: [');
    successResults.slice(0, 3).forEach((r, i) => {
      const comma = i < Math.min(2, successResults.length - 1) ? ',' : '';
      console.log(`  { urls: "stun:${r.host}:${r.port}" }${comma}  // ${r.name} - ${r.responseTime}ms`);
    });
    console.log(']');
  }
}

testAllServers().catch(console.error);
