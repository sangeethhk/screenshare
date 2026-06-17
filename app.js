/* ScreenVoice - P2P screen sharing, voice & chat */

const PEER_HOST = "0.peerjs.com";
const PEER_PORT = 443;
const PEER_PATH = "/";

let peer = null;
let roomName = "";
let username = "";
let myPeerId = "";
let isHost = false;

let localStream = null;
let muted = false;
let cameraOff = false;
let sharingScreen = false;

const cameraCalls = {};
const screenCalls = {};
const dataConns = {};
const peerNames = {};
const remoteSharing = {};

const $ = (id) => document.getElementById(id);
const selfVideo = $("selfVideo");
const videoGrid = $("videoGrid");
const lobby = $("lobby");
const room = $("room");
const roomNameEl = $("roomName");
const sidebarRoomName = $("sidebarRoomName");
const joinBtn = $("joinBtn");
const roomIdInput = $("roomId");
const usernameInput = $("usernameInput");
const micBtn = $("micBtn");
const camBtn = $("camBtn");
const screenBtn = $("screenBtn");
const leaveBtn = $("leaveBtn");
const connectionStatus = $("connectionStatus");
const selfName = $("selfName");
const usernameDisplay = $("usernameDisplay");
const usernameDisplayBottom = $("usernameDisplayBottom");
const avatarText = $("avatarText");
const avatarTextBottom = $("avatarTextBottom");
const inviteBox = $("inviteBox");
const inviteLink = $("inviteLink");
const copyBtn = $("copyBtn");
const userList = $("userList");
const userCount = $("userCount");
const chatMessages = $("chatMessages");
const chatInput = $("chatInput");
const chatSendBtn = $("chatSendBtn");

function log(...args) {
  console.log("[SV]", ...args);
}

function warn(...args) {
  console.warn("[SV]", ...args);
}

async function getLocalStream() {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    selfVideo.srcObject = localStream;
    selfVideo.style.display = "block";
    log("Got local stream (video+audio)");
  } catch (e) {
    warn("Media error:", e.message);
    addSystemMsg("Camera unavailable, trying audio only");
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true,
      });
      selfVideo.style.display = "none";
      log("Got local stream (audio only)");
    } catch (e2) {
      warn("No media available:", e2.message);
      addSystemMsg("No mic/camera access — chat only");
      localStream = new MediaStream();
    }
  }
}

function addChatMsg(author, text, isSystem) {
  const el = document.createElement("div");
  el.className = isSystem ? "chat-msg system" : "chat-msg";
  if (isSystem) {
    el.textContent = text;
  } else {
    const a = document.createElement("span");
    a.className = `author ${author === username ? "author-self" : ""}`;
    a.textContent = author;
    const t = document.createElement("span");
    t.className = "text";
    t.textContent = text;
    el.appendChild(a);
    el.appendChild(t);
  }
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemMsg(text) {
  addChatMsg("", text, true);
}

function getColorForPeer(id) {
  const colors = [
    "#f38ba8", "#fab387", "#f9e2af", "#a6e3a1",
    "#89b4fa", "#cba6f7", "#94e2d5", "#bac2de",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++)
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function updateUserList() {
  document
    .querySelectorAll(".user-item:not(#selfUserItem)")
    .forEach((e) => e.remove());
  let count = 1;
  for (const pid in peerNames) {
    if (pid === myPeerId) continue;
    count++;
    const div = document.createElement("div");
    div.className = "user-item";
    div.id = `user-${pid}`;
    const a = document.createElement("div");
    a.className = "avatar";
    a.style.background = getColorForPeer(pid);
    a.textContent = (peerNames[pid] || "?")[0].toUpperCase();
    const s = document.createElement("span");
    s.textContent = peerNames[pid] || pid.slice(0, 6);
    div.appendChild(a);
    div.appendChild(s);
    userList.appendChild(div);
  }
  userCount.textContent = count;
}

function getOrCreateContainer(pid, name, isScreen) {
  const suffix = isScreen ? "-screen" : "";
  let container = document.getElementById(`container-${pid}${suffix}`);
  if (!container) {
    container = document.createElement("div");
    container.className = `video-container${isScreen ? " screen-share" : ""}`;
    container.id = `container-${pid}${suffix}`;
    const video = document.createElement("video");
    video.id = `video-${pid}${suffix}`;
    video.autoplay = true;
    video.playsInline = true;
    container.appendChild(video);
    const label = document.createElement("div");
    label.className = "video-label";
    label.id = `label-${pid}${suffix}`;
    label.innerHTML = `<span>${isScreen ? (peerNames[pid] || pid.slice(0, 4)) + "'s screen" : name}</span><span class="mic-icon" id="remoteMic-${pid}${suffix}">&#x1f50a;</span>`;
    container.appendChild(label);
    videoGrid.appendChild(container);
    log(`Created container for ${pid}${isScreen ? " (screen)" : ""}`);
  } else {
    const label = document.getElementById(`label-${pid}${suffix}`);
    if (label)
      label.querySelector("span").textContent = isScreen
        ? (peerNames[pid] || pid.slice(0, 4)) + "'s screen"
        : name;
  }
  return container;
}

function removeContainer(pid, isScreen) {
  const suffix = isScreen ? "-screen" : "";
  const el = document.getElementById(`container-${pid}${suffix}`);
  if (el) el.remove();
}

function broadcastData(msg) {
  const m = typeof msg === "string" ? msg : JSON.stringify(msg);
  for (const id in dataConns) {
    try {
      dataConns[id].send(m);
    } catch {}
  }
}

function callPeerForMedia(pid, stream, store) {
  if (!stream || !stream.getTracks().length) {
    warn("callPeerForMedia: no stream tracks for", pid);
    return null;
  }
  if (store[pid]) {
    log("callPeerForMedia: already have call for", pid);
    return null;
  }
  try {
    log(`Calling ${pid} for media (${store === screenCalls ? "screen" : "camera"})`);
    const mc = peer.call(pid, stream);
    mc.on("stream", (remoteStream) => {
      log(`Received stream from ${pid}`);
      const isScreen = store === screenCalls;
      const container = getOrCreateContainer(
        pid,
        peerNames[pid] || pid.slice(0, 4),
        isScreen
      );
      const vid = document.getElementById(
        `video-${pid}${isScreen ? "-screen" : ""}`
      );
      if (vid) vid.srcObject = remoteStream;
      store[pid] = mc;
    });
    mc.on("close", () => {
      log(`Media call with ${pid} closed`);
      delete store[pid];
      const isScreen = store === screenCalls;
      removeContainer(pid, isScreen);
    });
    return mc;
  } catch (e) {
    warn("callPeerForMedia error", pid, e.message);
    return null;
  }
}

function answerCall(call) {
  if (!localStream) {
    warn("answerCall: no local stream");
    return;
  }
  log(`Answering call from ${call.peer}`);
  call.answer(localStream);
  call.on("stream", (remoteStream) => {
    const pid = call.peer;
    const isScreen = !!remoteSharing[pid];
    log(`Got stream from ${pid}${isScreen ? " (screen)" : ""}`);
    if (isScreen) {
      screenCalls[pid] = call;
    } else {
      cameraCalls[pid] = call;
    }
    const container = getOrCreateContainer(
      pid,
      peerNames[pid] || pid.slice(0, 4),
      isScreen
    );
    const vid = document.getElementById(
      `video-${pid}${isScreen ? "-screen" : ""}`
    );
    if (vid) vid.srcObject = remoteStream;
  });
  call.on("close", () => {
    log(`Call from ${call.peer} closed`);
    delete cameraCalls[call.peer];
    delete screenCalls[call.peer];
    removeContainer(call.peer, false);
    removeContainer(call.peer, true);
  });
}

function connectDataToPeer(pid) {
  if (dataConns[pid]) return;
  try {
    log(`Connecting data to ${pid}`);
    const conn = peer.connect(pid, { reliable: true });
    dataConns[pid] = conn;
    conn.on("open", () => {
      conn.send(
        JSON.stringify({ type: "info", name: username, id: myPeerId })
      );
    });
    conn.on("data", (d) => handleDataMessage(pid, d));
    conn.on("close", () => {
      log(`Data connection to ${pid} closed`);
      removePeer(pid);
    });
  } catch (e) {
    warn("connectData error", pid, e.message);
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
      broadcastData(data);
      break;

    case "join":
      log(`Join from ${id}: ${data.name}`);
      peerNames[id] = data.name;
      addSystemMsg(`${data.name} joined`);
      updateUserList();
      for (const pid in dataConns) {
        if (pid !== id)
          dataConns[pid].send(
            JSON.stringify({ type: "info", name: data.name, id })
          );
      }
      if (dataConns[id]) {
        log(`Sending welcome to ${id}`);
        dataConns[id].send(
          JSON.stringify({
            type: "welcome",
            name: username,
            peers: Object.fromEntries(
              Object.entries(peerNames).filter(
                ([k]) => k !== id && k !== myPeerId
              )
            ),
          })
        );
      } else {
        warn("join handler: no dataConns entry for", id);
      }
      break;

    case "welcome":
      log(`Welcome from ${id}: ${data.name}`);
      peerNames[id] = data.name;
      addSystemMsg(`Connected to room`);
      for (const pid in data.peers) {
        peerNames[pid] = data.peers[pid];
        connectDataToPeer(pid);
        callPeerForMedia(pid, localStream, cameraCalls);
      }
      callPeerForMedia(id, localStream, cameraCalls);
      updateUserList();
      connectionStatus.textContent = "Connected";
      connectionStatus.style.color = "#a6e3a1";
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

    case "mute": {
      const el = document.getElementById(`remoteMic-${id}`);
      if (el) {
        el.className = `mic-icon${data.muted ? " muted" : ""}`;
        el.innerHTML = data.muted ? "&#x1f507;" : "&#x1f50a;";
      }
      break;
    }

    case "screen-start":
      log(`${id} started screen share`);
      remoteSharing[id] = true;
      break;

    case "screen-stop":
      log(`${id} stopped screen share`);
      delete remoteSharing[id];
      if (screenCalls[id]) {
        try {
          screenCalls[id].close();
        } catch {}
        delete screenCalls[id];
      }
      removeContainer(id, true);
      break;
  }
}

function removePeer(id) {
  if (dataConns[id]) {
    try {
      dataConns[id].close();
    } catch {}
    delete dataConns[id];
  }
  if (cameraCalls[id]) {
    try {
      cameraCalls[id].close();
    } catch {}
    delete cameraCalls[id];
  }
  if (screenCalls[id]) {
    try {
      screenCalls[id].close();
    } catch {}
    delete screenCalls[id];
  }
  delete peerNames[id];
  delete remoteSharing[id];
  removeContainer(id, false);
  removeContainer(id, true);
  updateUserList();
}

function toggleMic() {
  muted = !muted;
  if (localStream)
    localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
  micBtn.classList.toggle("off", muted);
  const icon = document.getElementById("selfMicIcon");
  icon.className = `mic-icon${muted ? " muted" : ""}`;
  icon.innerHTML = muted ? "&#x1f507;" : "&#x1f50a;";
  broadcastData(JSON.stringify({ type: "mute", muted }));
}

function toggleCam() {
  cameraOff = !cameraOff;
  camBtn.classList.toggle("off", cameraOff);
  if (localStream) {
    localStream.getVideoTracks().forEach((t) => {
      t.enabled = !cameraOff;
    });
    selfVideo.style.display = cameraOff ? "none" : "block";
    if (!cameraOff) selfVideo.srcObject = localStream;
  }
}

async function startScreenShare() {
  try {
    const ss = await navigator.mediaDevices.getDisplayMedia({ video: true });
    if (!ss || !ss.getVideoTracks().length) return;

    screenStream = ss;
    sharingScreen = true;
    screenBtn.classList.add("screen-active");
    screenStream.getVideoTracks()[0].onended = stopScreenShare;

    selfVideo.srcObject = screenStream;
    log("Started screen share");

    broadcastData(JSON.stringify({ type: "screen-start" }));

    setTimeout(() => {
      const targets = {};
      for (const pid in cameraCalls) targets[pid] = true;
      if (isHost) {
        for (const pid in dataConns) {
          if (!cameraCalls[pid] && pid !== myPeerId) targets[pid] = true;
        }
      }
      for (const pid in targets) {
        callPeerForMedia(pid, screenStream, screenCalls);
      }
    }, 300);
  } catch (e) {
    warn("Screen share cancelled");
  }
}

function stopScreenShare() {
  if (!sharingScreen) return;
  sharingScreen = false;
  screenBtn.classList.remove("screen-active");
  log("Stopped screen share");

  for (const pid in screenCalls) {
    try {
      screenCalls[pid].close();
    } catch {}
    delete screenCalls[pid];
    removeContainer(pid, true);
  }
  broadcastData(JSON.stringify({ type: "screen-stop" }));

  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }

  if (localStream) {
    selfVideo.srcObject = localStream;
    selfVideo.style.display = cameraOff ? "none" : "block";
  }
}

let screenStream = null;

function leaveRoom() {
  log("Leaving room");
  broadcastData(JSON.stringify({ type: "leave" }));
  for (const id in dataConns) removePeer(id);
  for (const id in cameraCalls) removePeer(id);
  for (const id in screenCalls) removePeer(id);

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

  document
    .querySelectorAll(".video-container:not(#selfContainer)")
    .forEach((c) => c.remove());
  chatMessages.innerHTML = '<div class="chat-welcome">Chat messages appear here</div>';
  room.style.display = "none";
  lobby.style.display = "flex";
}

async function joinRoom() {
  const r = roomIdInput.value.trim() || `room-${Date.now()}`;
  roomName = r;
  username = usernameInput.value.trim() || `User${Math.floor(Math.random() * 1000)}`;

  roomNameEl.textContent = r;
  sidebarRoomName.textContent = r;
  selfName.textContent = username;
  usernameDisplay.textContent = username;
  usernameDisplayBottom.textContent = username;
  const init = username[0].toUpperCase();
  avatarText.textContent = init;
  avatarTextBottom.textContent = init;

  log(`Joining room "${r}" as "${username}"`);

  await getLocalStream();

  lobby.style.display = "none";
  room.style.display = "flex";
  connectionStatus.textContent = "Connecting...";
  connectionStatus.style.color = "#f9e2af";

  const hashRoom = window.location.hash.slice(1);
  isHost = !hashRoom;
  log(`isHost: ${isHost} (hash: "${hashRoom}")`);

  if (isHost) {
    myPeerId = `sv-${r}`;
    addSystemMsg(`Room "${r}" created. Share the invite link.`);
    connectionStatus.textContent = "Hosting - waiting for others...";
    connectionStatus.style.color = "#f9e2af";
    const url = `${window.location.origin}${window.location.pathname}#${r}`;
    inviteBox.style.display = "block";
    inviteLink.value = url;
  } else {
    myPeerId = `sv-${r}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    addSystemMsg(`Joining "${r}"...`);
    connectionStatus.textContent = "Connecting to host...";
    connectionStatus.style.color = "#f9e2af";
  }

  log(`My peer ID will be: ${myPeerId}`);

  peer = new Peer(myPeerId, {
    host: PEER_HOST,
    port: PEER_PORT,
    path: PEER_PATH,
    config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
  });

  peer.on("open", (id) => {
    myPeerId = id;
    peerNames[id] = username;
    log(`Peer open: ${id}`);
    addSystemMsg(`Connected to signaling server (ID: ${id.slice(0, 12)}...)`);
    connectionStatus.textContent = "Connected to signaling";
    connectionStatus.style.color = "#f9e2af";

    if (!isHost) {
      const hostId = `sv-${r}`;
      log(`Connecting to host ${hostId}...`);
      const conn = peer.connect(hostId, { reliable: true });
      conn.on("open", () => {
        log(`Data connection to host opened`);
        dataConns[hostId] = conn;
        conn.send(JSON.stringify({ type: "join", name: username }));
      });
      conn.on("data", (d) => handleDataMessage(hostId, d));
      conn.on("close", () => {
        addSystemMsg("Lost connection to host");
        removePeer(hostId);
      });
    } else {
      log("Waiting for incoming connections...");
    }
    updateUserList();
  });

  peer.on("connection", (conn) => {
    log(`Incoming data connection from ${conn.peer}`);
    dataConns[conn.peer] = conn;
    conn.on("open", () => {
      log(`Data connection from ${conn.peer} open`);
    });
    conn.on("data", (d) => handleDataMessage(conn.peer, d));
    conn.on("close", () => {
      log(`Data connection from ${conn.peer} closed`);
      removePeer(conn.peer);
    });
  });

  peer.on("call", answerCall);

  peer.on("error", (err) => {
    warn("PeerJS error:", err.type, err.message);
    addSystemMsg(`Connection error: ${err.type}`);
    if (err.type === "unavailable-id") {
      if (isHost) {
        addSystemMsg("Room name taken, joining as guest...");
        window.location.hash = roomName;
        isHost = false;
        peer.destroy();
        peer = null;
        setTimeout(joinRoom, 500);
      } else {
        addSystemMsg("Could not connect - try a different room name");
      }
    }
  });

  peer.on("disconnected", () => {
    log("Peer disconnected");
    connectionStatus.textContent = "Disconnected";
    connectionStatus.style.color = "#f38ba8";
    addSystemMsg("Connection to signaling server lost");
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
screenBtn.addEventListener("click", () =>
  sharingScreen ? stopScreenShare() : startScreenShare()
);
leaveBtn.addEventListener("click", leaveRoom);
chatSendBtn.addEventListener("click", () => {
  const text = chatInput.value.trim();
  if (!text) return;
  addChatMsg(username, text);
  broadcastData(JSON.stringify({ type: "chat", author: username, text }));
  chatInput.value = "";
});
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") chatSendBtn.click();
});

window.addEventListener("beforeunload", () => {
  if (room.style.display !== "none") leaveRoom();
});

if (window.location.hash) {
  roomIdInput.value = window.location.hash.slice(1);
}
