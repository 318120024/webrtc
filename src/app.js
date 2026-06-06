import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  getDatabase,
  ref,
  set,
  get,
  push,
  remove,
  onValue,
  onChildAdded,
  off,
  onDisconnect,
  serverTimestamp
} from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyB1ohgJExMps3YwIbTvU5GKJVTOGNxqWHg",
  authDomain: "webrtc-f1c77.firebaseapp.com",
  databaseURL: "https://webrtc-f1c77-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "webrtc-f1c77",
  storageBucket: "webrtc-f1c77.firebasestorage.app",
  messagingSenderId: "331514264045",
  appId: "1:331514264045:web:1c06dab627d393026d0fe4",
  measurementId: "G-5E0RJMJTFW"
};

const iceServers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

let uid = "";
let roomId = "";
let activeRoomId = "";
let isHost = false;
let chatPc = null;
let callPc = null;
let dataChannel = null;
let localStream = null;
let isMuted = false;
let isVideoEnabled = true;
let isVideoCall = false;
let isCleaningUp = false;
const unsubscribeFns = [];
const seenCandidates = new Set();

const els = {
  status: document.getElementById("status"),
  myIdDisplay: document.getElementById("myIdDisplay"),
  copyIdBtn: document.getElementById("copyIdBtn"),
  showQrBtn: document.getElementById("showQrBtn"),
  qrcode: document.getElementById("qrcode"),
  peerIdInput: document.getElementById("peerIdInput"),
  connectBtn: document.getElementById("connectBtn"),
  callBtn: document.getElementById("callBtn"),
  videoCallBtn: document.getElementById("videoCallBtn"),
  hangupBtn: document.getElementById("hangupBtn"),
  muteBtn: document.getElementById("muteBtn"),
  toggleVideoBtn: document.getElementById("toggleVideoBtn"),
  callStatus: document.getElementById("callStatus"),
  videoContainer: document.getElementById("videoContainer"),
  localVideo: document.getElementById("localVideo"),
  remoteVideo: document.getElementById("remoteVideo"),
  remoteAudio: document.getElementById("remoteAudio"),
  chat: document.getElementById("chat"),
  messageInput: document.getElementById("messageInput"),
  sendBtn: document.getElementById("sendBtn")
};

async function init() {
  try {
    updateStatus("正在匿名登录...");
    const { user } = await signInAnonymously(auth);
    uid = user.uid;

    const urlParams = new URLSearchParams(window.location.search);
    const incomingRoomId = urlParams.get("id");
    roomId = generateRoomId();
    activeRoomId = roomId;

    if (incomingRoomId) {
      els.peerIdInput.value = incomingRoomId;
      addChatMessage("系统", `检测到房间 ID: ${incomingRoomId}，初始化完成后可点击连接`);
    }

    await createHostRoom(roomId);
    els.myIdDisplay.innerHTML = `<div class="my-id-value">${roomId}</div>`;
    els.copyIdBtn.style.display = "inline-block";
    els.showQrBtn.style.display = "inline-block";
    els.connectBtn.disabled = false;
    updateStatus("等待连接");
    addChatMessage("系统", `你的房间 ID: ${roomId}`);
  } catch (err) {
    console.error("Firebase 初始化失败:", err);
    updateStatus("初始化失败");
    addChatMessage("系统", `初始化失败: ${err.message}`);
  }
}

async function createHostRoom(newRoomId) {
  isHost = true;
  activeRoomId = newRoomId;
  chatPc = createPeerConnection("chat", "callerCandidates");
  dataChannel = chatPc.createDataChannel("chat", { ordered: true });
  setupDataChannel(dataChannel);

  await set(ref(db, `rooms/${newRoomId}`), {
    createdBy: uid,
    createdAt: serverTimestamp(),
    participants: {
      [uid]: true
    }
  });
  onDisconnect(ref(db, `rooms/${newRoomId}`)).remove();

  const offer = await chatPc.createOffer();
  await chatPc.setLocalDescription(offer);
  await set(ref(db, `rooms/${newRoomId}/chat/offer`), normalizeDescription(offer));

  listenForDescription(`rooms/${newRoomId}/chat/answer`, async (answer) => {
    if (!chatPc || chatPc.currentRemoteDescription || !answer) return;
    await chatPc.setRemoteDescription(new RTCSessionDescription(answer));
    addChatMessage("系统", "对方已加入房间");
  });

  listenForCandidates(`rooms/${newRoomId}/chat/calleeCandidates`, chatPc);
  listenForCallOffers(newRoomId);
}

async function joinRoom(targetRoomId) {
  if (!targetRoomId) {
    alert("请输入房间 ID");
    return;
  }

  if (targetRoomId === roomId) {
    alert("不能连接到自己的房间");
    return;
  }

  try {
    updateStatus("正在连接...");
    addChatMessage("系统", `正在连接到房间 ${targetRoomId}...`);
    await remove(ref(db, `rooms/${roomId}`)).catch((err) => console.error("清理本机房间失败:", err));
    cleanupConnection(false);

    const roomSnap = await get(ref(db, `rooms/${targetRoomId}`));
    if (!roomSnap.exists()) {
      throw new Error("房间不存在或已关闭");
    }

    const offerSnap = await get(ref(db, `rooms/${targetRoomId}/chat/offer`));
    if (!offerSnap.exists()) {
      throw new Error("房间信令未就绪");
    }

    isHost = false;
    activeRoomId = targetRoomId;
    await set(ref(db, `rooms/${targetRoomId}/participants/${uid}`), true);
    onDisconnect(ref(db, `rooms/${targetRoomId}/participants/${uid}`)).remove();

    chatPc = createPeerConnection("chat", "calleeCandidates");
    chatPc.ondatachannel = (event) => {
      dataChannel = event.channel;
      setupDataChannel(dataChannel);
    };

    await chatPc.setRemoteDescription(new RTCSessionDescription(offerSnap.val()));
    const answer = await chatPc.createAnswer();
    await chatPc.setLocalDescription(answer);
    await set(ref(db, `rooms/${targetRoomId}/chat/answer`), normalizeDescription(answer));

    listenForCandidates(`rooms/${targetRoomId}/chat/callerCandidates`, chatPc);
    listenForCallOffers(targetRoomId);
  } catch (err) {
    console.error("连接失败:", err);
    updateStatus("连接失败");
    addChatMessage("系统", `连接失败: ${err.message}`);
  }
}

function createPeerConnection(scope, localCandidateKey) {
  const pc = new RTCPeerConnection(iceServers);

  pc.onicecandidate = async (event) => {
    if (!event.candidate || !activeRoomId) return;
    try {
      await push(ref(db, `rooms/${activeRoomId}/${scope}/${localCandidateKey}`), event.candidate.toJSON());
    } catch (err) {
      console.error("写入 ICE candidate 失败:", err);
    }
  };

  pc.onconnectionstatechange = () => {
    if (scope === "chat") {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        updateStatus("连接已断开");
      }
      if (pc.connectionState === "connected") {
        updateStatus("已连接");
      }
    }
  };

  return pc;
}

function setupDataChannel(channel) {
  channel.onopen = () => {
    updateStatus("已连接");
    addChatMessage("系统", "P2P 连接成功，可以开始聊天");
    els.messageInput.disabled = false;
    els.sendBtn.disabled = false;
    els.connectBtn.disabled = true;
    els.callBtn.disabled = false;
    els.videoCallBtn.disabled = false;
  };

  channel.onmessage = (event) => {
    addChatMessage("对方", event.data);
  };

  channel.onclose = () => {
    updateStatus("连接已关闭");
    addChatMessage("系统", "连接已关闭");
    els.messageInput.disabled = true;
    els.sendBtn.disabled = true;
    els.connectBtn.disabled = false;
    els.callBtn.disabled = true;
    els.videoCallBtn.disabled = true;
    hangupCall(false);
  };

  channel.onerror = (err) => {
    console.error("DataChannel 错误:", err);
    updateStatus("连接失败");
  };
}

function listenForDescription(path, handler) {
  const nodeRef = ref(db, path);
  const callback = (snapshot) => {
    if (snapshot.exists()) {
      handler(snapshot.val()).catch((err) => console.error("处理 SDP 失败:", err));
    }
  };
  onValue(nodeRef, callback);
  unsubscribeFns.push(() => off(nodeRef, "value", callback));
}

function listenForCandidates(path, pc) {
  const nodeRef = ref(db, path);
  const callback = (snapshot) => {
    const key = `${path}/${snapshot.key}`;
    if (seenCandidates.has(key) || !snapshot.exists()) return;
    seenCandidates.add(key);
    pc.addIceCandidate(new RTCIceCandidate(snapshot.val()))
      .catch((err) => console.error("添加 ICE candidate 失败:", err));
  };
  onChildAdded(nodeRef, callback);
  unsubscribeFns.push(() => off(nodeRef, "child_added", callback));
}

function listenForCallOffers(targetRoomId) {
  const offerRef = ref(db, `rooms/${targetRoomId}/call/offer`);
  const callback = (snapshot) => {
    if (!snapshot.exists() || callPc) return;
    answerIncomingCall(targetRoomId).catch((err) => {
      console.error("接听失败:", err);
      updateCallStatus("通话失败");
      addChatMessage("系统", `接听失败: ${err.message}`);
      cleanupCall(false);
    });
  };
  onValue(offerRef, callback);
  unsubscribeFns.push(() => off(offerRef, "value", callback));
}

async function startCall(withVideo) {
  if (!isDataChannelOpen()) {
    alert("请先建立连接");
    return;
  }

  try {
    isVideoCall = withVideo;
    updateCallStatus(withVideo ? "正在获取摄像头和麦克风权限..." : "正在获取麦克风权限...");
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });

    if (withVideo) {
      showVideoUI();
      els.localVideo.srcObject = localStream;
    }

    callPc = createPeerConnection("call", "callerCandidates");
    setupCallPeerConnection(callPc);
    localStream.getTracks().forEach((track) => callPc.addTrack(track, localStream));

    await remove(ref(db, `rooms/${activeRoomId}/call`));
    await set(ref(db, `rooms/${activeRoomId}/call`), {
      active: true,
      type: withVideo ? "video" : "audio",
      startedBy: uid,
      startedAt: serverTimestamp()
    });

    const offer = await callPc.createOffer();
    await callPc.setLocalDescription(offer);
    await set(ref(db, `rooms/${activeRoomId}/call/offer`), normalizeDescription(offer));

    listenForDescription(`rooms/${activeRoomId}/call/answer`, async (answer) => {
      if (!callPc || callPc.currentRemoteDescription || !answer) return;
      await callPc.setRemoteDescription(new RTCSessionDescription(answer));
    });
    listenForCandidates(`rooms/${activeRoomId}/call/calleeCandidates`, callPc);

    updateCallStatus(withVideo ? "正在发起视频通话..." : "正在发起语音通话...");
    addChatMessage("系统", withVideo ? "正在发起视频通话..." : "正在发起语音通话...");
  } catch (err) {
    console.error("无法发起通话:", err);
    alert("无法获取媒体权限或发起通话，请检查浏览器设置");
    updateCallStatus("");
    cleanupCall(false);
  }
}

async function answerIncomingCall(targetRoomId) {
  updateCallStatus("收到来电，正在接听...");
  addChatMessage("系统", "收到来电...");

  const callSnap = await get(ref(db, `rooms/${targetRoomId}/call`));
  const callData = callSnap.val();
  if (!callData || !callData.offer) return;
  if (callData.startedBy === uid) return;

  isVideoCall = callData.type === "video";
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideoCall });

  if (isVideoCall) {
    showVideoUI();
    els.localVideo.srcObject = localStream;
  }

  callPc = createPeerConnection("call", "calleeCandidates");
  setupCallPeerConnection(callPc);
  localStream.getTracks().forEach((track) => callPc.addTrack(track, localStream));

  await callPc.setRemoteDescription(new RTCSessionDescription(callData.offer));
  const answer = await callPc.createAnswer();
  await callPc.setLocalDescription(answer);
  await set(ref(db, `rooms/${targetRoomId}/call/answer`), normalizeDescription(answer));

  listenForCandidates(`rooms/${targetRoomId}/call/callerCandidates`, callPc);
}

function setupCallPeerConnection(pc) {
  pc.ontrack = (event) => {
    const [remoteStream] = event.streams;
    if (isVideoCall) {
      els.remoteVideo.srcObject = remoteStream;
      updateCallStatus("视频通话中");
      addChatMessage("系统", "视频通话已建立");
    } else {
      els.remoteAudio.srcObject = remoteStream;
      updateCallStatus("语音通话中");
      addChatMessage("系统", "语音通话已建立");
    }

    els.callBtn.disabled = true;
    els.videoCallBtn.disabled = true;
    els.hangupBtn.disabled = false;
    els.muteBtn.disabled = false;
    els.toggleVideoBtn.disabled = !isVideoCall;
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") {
      cleanupCall(false);
    }
  };
}

async function hangupCall(announce = true) {
  await cleanupCall(true);
  if (announce) {
    addChatMessage("系统", "已挂断通话");
  }
}

async function cleanupCall(clearRemoteSignal) {
  if (callPc) {
    callPc.close();
    callPc = null;
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  els.remoteAudio.srcObject = null;
  els.localVideo.srcObject = null;
  els.remoteVideo.srcObject = null;
  hideVideoUI();

  els.callBtn.disabled = !isDataChannelOpen();
  els.videoCallBtn.disabled = !isDataChannelOpen();
  els.hangupBtn.disabled = true;
  els.muteBtn.disabled = true;
  els.toggleVideoBtn.disabled = true;
  els.muteBtn.textContent = "静音";
  els.muteBtn.style.background = "#4CAF50";
  els.toggleVideoBtn.textContent = "关闭摄像头";
  els.toggleVideoBtn.style.background = "#4CAF50";
  isMuted = false;
  isVideoEnabled = true;
  isVideoCall = false;
  updateCallStatus("");

  if (clearRemoteSignal && activeRoomId) {
    await remove(ref(db, `rooms/${activeRoomId}/call`)).catch((err) => console.error("清理通话信令失败:", err));
  }
}

function cleanupConnection(keepHostRoom) {
  unsubscribeFns.splice(0).forEach((unsubscribe) => unsubscribe());
  seenCandidates.clear();

  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }

  if (chatPc) {
    chatPc.close();
    chatPc = null;
  }

  cleanupCall(false);

  els.messageInput.disabled = true;
  els.sendBtn.disabled = true;
  els.callBtn.disabled = true;
  els.videoCallBtn.disabled = true;

  if (keepHostRoom && roomId) {
    createHostRoom(roomId).catch((err) => {
      console.error("重建房间失败:", err);
      updateStatus("初始化失败");
    });
  }
}

async function cleanupBeforeUnload() {
  if (isCleaningUp || !activeRoomId || !uid) return;
  isCleaningUp = true;

  try {
    if (isHost) {
      await remove(ref(db, `rooms/${activeRoomId}`));
    } else {
      await remove(ref(db, `rooms/${activeRoomId}/participants/${uid}`));
    }
  } catch (err) {
    console.error("离开清理失败:", err);
  }
}

function sendMessage() {
  const msg = els.messageInput.value.trim();
  if (!msg || !isDataChannelOpen()) return;

  dataChannel.send(msg);
  addChatMessage("我", msg);
  els.messageInput.value = "";
}

function isDataChannelOpen() {
  return dataChannel && dataChannel.readyState === "open";
}

function normalizeDescription(description) {
  return {
    type: description.type,
    sdp: description.sdp
  };
}

function generateRoomId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function showVideoUI() {
  els.videoContainer.style.display = "flex";
}

function hideVideoUI() {
  els.videoContainer.style.display = "none";
}

function updateCallStatus(text) {
  els.callStatus.textContent = text;
}

function updateStatus(text) {
  els.status.textContent = text;

  if (text.includes("已连接")) {
    els.status.className = "status connected";
  } else if (text.includes("失败") || text.includes("断开") || text.includes("关闭")) {
    els.status.className = "status failed";
  } else {
    els.status.className = "status waiting";
  }
}

function addChatMessage(sender, msg) {
  const time = new Date().toLocaleTimeString();
  const div = document.createElement("div");
  const small = document.createElement("small");
  const strong = document.createElement("b");
  small.textContent = time;
  strong.textContent = `${sender}:`;
  div.append(small, " ", strong, ` ${msg}`);
  els.chat.appendChild(div);
  els.chat.scrollTop = els.chat.scrollHeight;
}

els.connectBtn.addEventListener("click", () => {
  joinRoom(els.peerIdInput.value.trim());
});

els.callBtn.addEventListener("click", () => {
  startCall(false);
});

els.videoCallBtn.addEventListener("click", () => {
  startCall(true);
});

els.hangupBtn.addEventListener("click", () => {
  hangupCall(true);
});

els.muteBtn.addEventListener("click", () => {
  if (!localStream) return;

  isMuted = !isMuted;
  localStream.getAudioTracks().forEach((track) => {
    track.enabled = !isMuted;
  });

  if (isMuted) {
    els.muteBtn.textContent = "取消静音";
    els.muteBtn.style.background = "#FF9800";
    updateCallStatus(isVideoCall ? "视频通话中（已静音）" : "语音通话中（已静音）");
  } else {
    els.muteBtn.textContent = "静音";
    els.muteBtn.style.background = "#4CAF50";
    updateCallStatus(isVideoCall ? "视频通话中" : "语音通话中");
  }
});

els.toggleVideoBtn.addEventListener("click", () => {
  if (!localStream || !isVideoCall) return;

  isVideoEnabled = !isVideoEnabled;
  localStream.getVideoTracks().forEach((track) => {
    track.enabled = isVideoEnabled;
  });

  if (isVideoEnabled) {
    els.toggleVideoBtn.textContent = "关闭摄像头";
    els.toggleVideoBtn.style.background = "#4CAF50";
  } else {
    els.toggleVideoBtn.textContent = "开启摄像头";
    els.toggleVideoBtn.style.background = "#FF9800";
  }
});

els.copyIdBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(roomId).then(() => {
    alert("房间 ID 已复制到剪贴板");
  });
});

els.showQrBtn.addEventListener("click", () => {
  if (els.qrcode.style.display === "none") {
    els.qrcode.innerHTML = "";
    els.qrcode.style.display = "block";

    const url = `${window.location.origin}${window.location.pathname}?id=${roomId}`;
    new QRCode(els.qrcode, {
      text: url,
      width: 256,
      height: 256
    });

    els.showQrBtn.textContent = "隐藏二维码";
  } else {
    els.qrcode.style.display = "none";
    els.showQrBtn.textContent = "显示二维码";
  }
});

els.sendBtn.addEventListener("click", sendMessage);

els.messageInput.addEventListener("keypress", (event) => {
  if (event.key === "Enter") {
    sendMessage();
  }
});

window.addEventListener("beforeunload", () => {
  cleanupBeforeUnload();
});

init();