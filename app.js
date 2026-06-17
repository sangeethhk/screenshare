const PEER_HOST = "0.peerjs.com";
const PEER_PORT = 443;
const PEER_PATH = "/";

let peer = null;
let roomName = "";
let username = "";
let myPeerId = "";
let isHost = false;

let localStream = null;
let screenStream = null;
let muted = false;
let cameraOff = false;
let sharingScreen = false;

const peers = {};
const dataConns = {};
const peerNames = {};
const pendingCalls = {};

const selfVideo = document.getElementById("selfVideo");
const videoGrid = document.getElementById("videoGrid");
const lobby = document.getElementById("lobby");
const room = document.getElementById("room");
const roomNameEl = document.getElementById("roomName");
const sidebarRoomName = document.getElementById("sidebarRoomName");
const joinBtn = document.getElementById("joinBtn");
const roomIdInput = document.getElementById("roomId");
const usernameInput = document.getElementById("usernameInput");
const micBtn = document.getElementById("micBtn");
const camBtn = document.getElementById("camBtn");
const screenBtn = document.getElementById("screenBtn");
const leaveBtn = document.getElementById("leaveBtn");
const connectionStatus = document.getElementById("connectionStatus");
const selfName = document.getElementById("selfName");
const usernameDisplay = document.getElementById("usernameDisplay");
const usernameDisplayBottom = document.getElementById("usernameDisplayBottom");
const avatarText = document.getElementById("avatarText");
const avatarTextBottom = document.getElementById("avatarTextBottom");
const inviteBox = document.getElementById("inviteBox");
const inviteLink = document.getElementById("inviteLink");
const copyBtn = document.getElementById("copyBtn");
const userList = document.getElementById("userList");
const userCount = document.getElementById("userCount");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");

async function getLocalStream(withVideo = true) {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: withVideo && !cameraOff,
      audio: true,
    });
    selfVideo.srcObject = localStream;
    selfVideo.style.display = "block";
  } catch (e) {
    console.warn("Media error:", e.message);
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true,
      });
      selfVideo.style.display = "none";
    } catch (e2) {
      localStream = new MediaStream();
    }
  }
}

function addChatMsg(author, text, isSystem = false) {
  const el = document.createElement("div");
  el.className = isSystem ? "chat-msg system" : "chat-msg";
  if (isSystem) {
    el.textContent = text;
  } else {
    const authorSpan = document.createElement("span");
    authorSpan.className = `author ${author === username ? "author-self" : ""}`;
    authorSpan.textContent = author;
    const textSpan = document.createElement("span");
    textSpan.className = "text";
    textSpan.textContent = text;
    el.appendChild(authorSpan);
    el.appendChild(textSpan);
  }
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemMsg(text) {
  addChatMsg("", text, true);
}

function updateUserList() {
  const existing = userList.querySelectorAll(".user-item:not(#selfUserItem)");
  existing.forEach((el) => el.remove());

  let count = 1;
  for (const id in peerNames) {
    if (id === myPeerId) continue;
    count++;
    const div = document.createElement("div");
    div.className = "user-item";
    div.id = `user-${id}`;
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.style.background = getColorForPeer(id);
    avatar.textContent = peerNames[id][0].toUpperCase();
    const nameSpan = document.createElement("span");
    nameSpan.textContent = peerNames[id];
    div.appendChild(avatar);
    div.appendChild(nameSpan);
    userList.appendChild(div);
  }
  userCount.textContent = count;
}

function getColorForPeer(id) {
  const colors = ["#f38ba8", "#fab387", "#f9e2af", "#a6e3a1", "#89b4fa", "#cba6f7", "#94e2d5", "#bac2de"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function removeVideoContainer(id) {
  const el = document.getElementById(`container-${id}`);
  if (el) el.remove();
}

function getOrCreateVideoContainer(id, name) {
  let container = document.getElementById(`container-${id}`);
  if (!container) {
    container = document.createElement("div");
    container.className = "video-container";
    container.id = `container-${id}`;
    const video = document.createElement("video");
    video.id = `video-${id}`;
    video.autoplay = true;
    video.playsInline = true;
    container.appendChild(video);
    const label = document.createElement("div");
    label.className = "video-label";
    label.id = `label-${id}`;
    label.innerHTML = `<span>${name}</span><span class="mic-icon" id="remoteMic-${id}">&#x1f50a;</span>`;
    container.appendChild(label);
    videoGrid.appendChild(container);
  } else {
    const label = document.getElementById(`label-${id}`);
    if (label) label.querySelector("span").textContent = name;
  }
  return container;
}

function broadcastToPeers(data) {
  const msg = typeof data === "string" ? data : JSON.stringify(data);
  for (const id in dataConns) {
    try {
      dataConns[id].send(msg);
    } catch (e) {
      console.warn("Send error to", id, e.message);
    }
  }
}

function handleDataMessage(id, raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }

  switch (data.type) {
    case "chat":
      addChatMsg(data.author, data.text);
      broadcastToPeers(data);
      break;
    case "join":
      peerNames[id] = data.name;
      addSystemMsg(`${data.name} joined`);
      updateUserList();

      for (const pid in dataConns) {
        if (pid !== id) {
          dataConns[pid].send(JSON.stringify({ type: "info", name: data.name, id }));
        }
      }

      if (dataConns[id]) {
        dataConns[id].send(JSON.stringify({
          type: "welcome",
          name: username,
          peers: Object.fromEntries(
            Object.entries(peerNames).filter(([k]) => k !== id && k !== myPeerId)
          ),
        }));
      }
      break;
    case "welcome":
      peerNames[id] = data.name;
      addSystemMsg(`Connected to room`);

      function callPeer(pid) {
        if (!localStream || peers[pid]) return;
        try {
          const mediaCall = peer.call(pid, localStream);
          mediaCall.on("stream", (remoteStream) => {
            const container = getOrCreateVideoContainer(pid, peerNames[pid] || pid.slice(0, 6));
            const video = document.getElementById(`video-${pid}`);
            if (video) video.srcObject = remoteStream;
            peers[pid] = mediaCall;
          });
          mediaCall.on("close", () => removePeer(pid));
        } catch (e) {
          console.warn("Failed to call", pid, e.message);
        }
      }
      function connectData(pid) {
        if (dataConns[pid]) return;
        try {
          const conn = peer.connect(pid, { reliable: true });
          conn.on("open", () => {
            dataConns[pid] = conn;
            conn.send(JSON.stringify({ type: "info", name: username, id: myPeerId }));
          });
          conn.on("data", (d) => handleDataMessage(pid, d));
          conn.on("close", () => removePeer(pid));
        } catch (e) {
          console.warn("Failed data connect to", pid, e.message);
        }
      }

      for (const pid in data.peers) {
        peerNames[pid] = data.peers[pid];
        connectData(pid);
        callPeer(pid);
      }

      callPeer(id);
      updateUserList();
      break;
    case "info":
      peerNames[data.id || id] = data.name;
      updateUserList();
      addSystemMsg(`${data.name} connected`);
      break;
    case "leave":
      addSystemMsg(`${peerNames[id] || "Someone"} left`);
      removePeer(id);
      break;
    case "mute":
      const micIcon = document.getElementById(`remoteMic-${id}`);
      if (micIcon) {
        micIcon.className = `mic-icon${data.muted ? " muted" : ""}`;
        micIcon.innerHTML = data.muted ? "&#x1f507;" : "&#x1f50a;";
      }
      break;
    case "screen":
      const container = document.getElementById(`container-${id}`);
      if (container) container.classList.toggle("screen-share", data.active);
      break;
    case "camera":
      break;
  }
}

function removePeer(id) {
  if (dataConns[id]) {
    try { dataConns[id].close(); } catch {}
    delete dataConns[id];
  }
  if (peers[id]) {
    try { peers[id].close(); } catch {}
    delete peers[id];
  }
  delete peerNames[id];
  removeVideoContainer(id);
  updateUserList();
}

function toggleMic() {
  muted = !muted;
  if (localStream) localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
  micBtn.classList.toggle("off", muted);
  document.getElementById("selfMicIcon").className = `mic-icon${muted ? " muted" : ""}`;
  document.getElementById("selfMicIcon").innerHTML = muted ? "&#x1f507;" : "&#x1f50a;";
  broadcastToPeers(JSON.stringify({ type: "mute", muted }));
}

function toggleCam() {
  cameraOff = !cameraOff;
  camBtn.classList.toggle("off", cameraOff);
  if (localStream) {
    const tracks = localStream.getVideoTracks();
    if (cameraOff) {
      tracks.forEach((t) => {
        t.stop();
        localStream.removeTrack(t);
      });
      selfVideo.style.display = "none";
    } else {
      navigator.mediaDevices.getUserMedia({ video: true }).then((s) => {
        const newTrack = s.getVideoTracks()[0];
        localStream.addTrack(newTrack);
        selfVideo.srcObject = localStream;
        selfVideo.style.display = "block";
        for (const id in peers) {
          const sender = peers[id].getSenders().find((s) => s.track?.kind === "video");
          if (sender) sender.replaceTrack(newTrack);
        }
      });
    }
  }
  broadcastToPeers(JSON.stringify({ type: "camera", off: cameraOff }));
}

async function startScreenShare() {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenStream.getVideoTracks()[0].onended = stopScreenShare;
    sharingScreen = true;
    screenBtn.classList.add("screen-active");

    const screenTrack = screenStream.getVideoTracks()[0];
    if (localStream) {
      const oldTrack = localStream.getVideoTracks()[0];
      if (oldTrack && !cameraOff) {
        localStream.removeTrack(oldTrack);
        oldTrack.stop();
      }
    } else {
      localStream = new MediaStream();
    }
    localStream.addTrack(screenTrack);
    selfVideo.srcObject = localStream;

    for (const id in peers) {
      const sender = peers[id].getSenders().find((s) => s.track?.kind === "video");
      if (sender) sender.replaceTrack(screenTrack);
    }
    broadcastToPeers(JSON.stringify({ type: "screen", active: true }));
  } catch (e) {
    console.warn("Screen share cancelled");
  }
}

function stopScreenShare() {
  if (!sharingScreen) return;
  sharingScreen = false;
  screenBtn.classList.remove("screen-active");
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }
  if (!cameraOff) {
    navigator.mediaDevices.getUserMedia({ video: true }).then((s) => {
      const camTrack = s.getVideoTracks()[0];
      if (localStream) {
        const oldTrack = localStream.getVideoTracks()[0];
        if (oldTrack) localStream.removeTrack(oldTrack);
        localStream.addTrack(camTrack);
      }
      selfVideo.srcObject = localStream;
      for (const id in peers) {
        const sender = peers[id].getSenders().find((s) => s.track?.kind === "video");
        if (sender) sender.replaceTrack(camTrack);
      }
    });
  }
  broadcastToPeers(JSON.stringify({ type: "screen", active: false }));
}

function leaveRoom() {
  broadcastToPeers(JSON.stringify({ type: "leave" }));
  for (const id in dataConns) removePeer(id);
  for (const id in peers) removePeer(id);
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }
  if (peer) {
    peer.destroy();
    peer = null;
  }
  sharingScreen = false;
  muted = false;
  cameraOff = false;
  screenBtn.classList.remove("screen-active");
  camBtn.classList.remove("off");
  micBtn.classList.remove("off");
  isHost = false;

  const containers = videoGrid.querySelectorAll(".video-container:not(#selfContainer)");
  containers.forEach((c) => c.remove());
  chatMessages.innerHTML = '<div class="chat-welcome">Chat messages appear here</div>';

  room.style.display = "none";
  lobby.style.display = "flex";
}

async function joinRoom() {
  const room = roomIdInput.value.trim() || `room-${Date.now()}`;
  roomName = room;
  username = usernameInput.value.trim() || `User${Math.floor(Math.random() * 1000)}`;

  roomNameEl.textContent = room;
  sidebarRoomName.textContent = room;
  selfName.textContent = username;
  usernameDisplay.textContent = username;
  usernameDisplayBottom.textContent = username;
  const initial = username[0].toUpperCase();
  avatarText.textContent = initial;
  avatarTextBottom.textContent = initial;

  await getLocalStream();

  lobby.style.display = "none";
  document.getElementById("room").style.display = "flex";
  connectionStatus.textContent = "Connecting...";
  connectionStatus.style.color = "#f9e2af";

  const hashRoom = window.location.hash.slice(1);
  isHost = !hashRoom || hashRoom === room;

  if (isHost) {
    myPeerId = `sv-${room}`;
    addSystemMsg(`You created "${room}". Share the invite link with friends.`);
    connectionStatus.textContent = "Hosting — waiting for others";
    connectionStatus.style.color = "#f9e2af";

    const url = `${window.location.origin}${window.location.pathname}#${room}`;
    inviteBox.style.display = "block";
    inviteLink.value = url;
  } else {
    myPeerId = `sv-${room}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    addSystemMsg(`Joining "${room}"...`);
    connectionStatus.textContent = "Connecting to host...";
    connectionStatus.style.color = "#f9e2af";
  }

  peer = new Peer(myPeerId, {
    host: PEER_HOST,
    port: PEER_PORT,
    path: PEER_PATH,
    config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
  });

  peer.on("open", (id) => {
    myPeerId = id;
    peerNames[id] = username;

    if (!isHost) {
      const hostId = `sv-${room}`;
      const conn = peer.connect(hostId, { reliable: true });
      conn.on("open", () => {
        dataConns[hostId] = conn;
        conn.send(JSON.stringify({ type: "join", name: username }));
      });
      conn.on("data", (d) => handleDataMessage(hostId, d));
      conn.on("close", () => {
        addSystemMsg("Lost connection to room host");
        removePeer(hostId);
      });
    }

    updateUserList();
  });

  peer.on("connection", (conn) => {
    conn.on("open", () => {
      dataConns[conn.peer] = conn;
    });
    conn.on("data", (d) => handleDataMessage(conn.peer, d));
    conn.on("close", () => removePeer(conn.peer));
  });

  peer.on("call", (call) => {
    call.answer(localStream);
    call.on("stream", (remoteStream) => {
      const container = getOrCreateVideoContainer(call.peer, peerNames[call.peer] || call.peer.slice(0, 6));
      const video = document.getElementById(`video-${call.peer}`);
      if (video) video.srcObject = remoteStream;
      peers[call.peer] = call;
    });
    call.on("close", () => removePeer(call.peer));
  });

  peer.on("error", (err) => {
    console.error("PeerJS error:", err);
    if (err.type === "unavailable-id" && isHost) {
      addSystemMsg("Room name taken, joining as guest...");
      isHost = false;
      window.location.hash = "";
      peer.destroy();
      peer = null;
      setTimeout(joinRoom, 500);
    }
  });

  peer.on("disconnected", () => {
    connectionStatus.textContent = "Disconnected";
    connectionStatus.style.color = "#f38ba8";
  });
}

copyBtn.addEventListener("click", () => {
  inviteLink.select();
  navigator.clipboard.writeText(inviteLink.value);
  copyBtn.textContent = "Copied!";
  setTimeout(() => (copyBtn.textContent = "Copy"), 2000);
});

joinBtn.addEventListener("click", joinRoom);
roomIdInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinRoom();
});
usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinRoom();
});

micBtn.addEventListener("click", toggleMic);
camBtn.addEventListener("click", toggleCam);
screenBtn.addEventListener("click", () => (sharingScreen ? stopScreenShare() : startScreenShare()));
leaveBtn.addEventListener("click", leaveRoom);

chatSendBtn.addEventListener("click", () => {
  const text = chatInput.value.trim();
  if (!text) return;
  addChatMsg(username, text);
  broadcastToPeers(JSON.stringify({ type: "chat", author: username, text }));
  chatInput.value = "";
});
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") chatSendBtn.click();
});

window.addEventListener("beforeunload", () => {
  if (document.getElementById("room").style.display !== "none") leaveRoom();
});

if (window.location.hash) {
  roomIdInput.value = window.location.hash.slice(1);
}
