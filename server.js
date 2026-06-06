const APP_ID = 'xinling-trystero-test-v1'
const ROOM_ID = 'xinling-home-server-room-20260606-private-k7x9m2q4'
const PASSWORD = 'xinling-test-password'
const SERVER_NAME = process.env.SERVER_NAME || 'home-pc-server'
const PUSH_INTERVAL_MS = 5000
const TURN_URL = 'turn:openrelay.metered.ca:443?transport=tcp'
const TURN_USERNAME = 'openrelayproject'
const TURN_CREDENTIAL = 'openrelayproject'

async function main() {
  const [{ joinRoom, selfId }, { RTCPeerConnection }] = await Promise.all([
    import('trystero'),
    import('werift')
  ])

  const peers = new Set()
  let pushSeq = 0

  const roomConfig = {
    appId: APP_ID,
    password: PASSWORD,
    rtcPolyfill: RTCPeerConnection
  }

  if (TURN_URL && TURN_USERNAME && TURN_CREDENTIAL) {
    roomConfig.turnConfig = [
      {
        urls: [TURN_URL],
        username: TURN_USERNAME,
        credential: TURN_CREDENTIAL
      }
    ]
  }

  const room = joinRoom(
    roomConfig,
    ROOM_ID,
    {
      onJoinError: details => {
        log('join error', details)
      }
    }
  )

  const hello = room.makeAction('hello')
  const clientMessage = room.makeAction('client-message')
  const serverReply = room.makeAction('server-reply')
  const serverPush = room.makeAction('server-push')
  const statusRequest = room.makeAction('status-request', {
    kind: 'request',
    onRequest: data => ({
      ok: true,
      serverName: SERVER_NAME,
      serverPeerId: selfId,
      serverTime: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      peerCount: peers.size,
      request: data || null
    })
  })

  room.onPeerJoin = peerId => {
    peers.add(peerId)
    log('peer joined', peerId)
    sendHello(peerId).catch(error => {
      log('hello failed', { peerId, error: String(error) })
    })
  }

  room.onPeerLeave = peerId => {
    peers.delete(peerId)
    log('peer left', peerId)
  }

  clientMessage.onMessage = async (data, { peerId }) => {
    log('client message', { peerId, data })

    await serverReply.send(
      {
        ok: true,
        type: 'echo',
        from: SERVER_NAME,
        serverPeerId: selfId,
        serverTime: new Date().toISOString(),
        received: data
      },
      { target: peerId }
    )
  }

  function sendHello(peerId) {
    return hello.send(
      {
        role: 'server',
        serverName: SERVER_NAME,
        serverPeerId: selfId,
        roomId: ROOM_ID,
        time: new Date().toISOString()
      },
      { target: peerId }
    )
  }

  async function broadcastPush() {
    pushSeq += 1

    const payload = {
      type: 'tick',
      seq: pushSeq,
      from: SERVER_NAME,
      serverPeerId: selfId,
      serverTime: new Date().toISOString(),
      peerCount: peers.size,
      message: `server push #${pushSeq}`
    }

    try {
      await serverPush.send(payload)
      log('pushed', payload)
    } catch (error) {
      log('push failed', error)
    }
  }

  log('server online', {
    appId: APP_ID,
    roomId: ROOM_ID,
    serverName: SERVER_NAME,
    turnEnabled: Boolean(roomConfig.turnConfig),
    selfId
  })

  setInterval(broadcastPush, PUSH_INTERVAL_MS)

  process.on('SIGINT', () => {
    log('leaving room')
    room.leave()
    process.exit(0)
  })
}

function log(label, value) {
  const time = new Date().toISOString()

  if (value === undefined) {
    console.log(`[${time}] ${label}`)
    return
  }

  console.log(`[${time}] ${label}:`, value)
}

main().catch(error => {
  console.error('Failed to start Trystero server peer.')
  console.error(error)
  console.error('')
  console.error('Install dependencies first:')
  console.error('  npm i trystero werift')
  console.error('')
  console.error('Optional TURN example:')
  console.error("  $env:TURN_URL='turn:your-turn.example.com:3478'")
  console.error("  $env:TURN_USERNAME='user'")
  console.error("  $env:TURN_CREDENTIAL='pass'")
  console.error('  node server.js')
  process.exit(1)
})
