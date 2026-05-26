// SSE 后端：模拟仿真引擎高频推送实体状态
// 前端通过 EventSource 连接 http://localhost:3001/api/stream
import http from 'node:http'

const PORT = 3001

// ========== 实体模拟 ==========
const TYPES = [
  { icon: '🛩️', type: '战斗机', speed: 800 },
  { icon: '🚁', type: '直升机', speed: 250 },
  { icon: '🚢', type: '驱逐舰', speed: 30 },
  { icon: '🚛', type: '装甲车', speed: 70 },
  { icon: '🎯', type: '导弹', speed: 2500 },
]

function createEntities(count) {
  const entities = []
  for (let i = 0; i < count; i++) {
    const t = TYPES[i % TYPES.length]
    entities.push({
      id: i,
      lat: 21.5 + (Math.random() - 0.5) * 4,
      lng: 118.5 + (Math.random() - 0.5) * 5,
      heading: 0,
      speed: t.speed,
      icon: t.icon,
      type: t.type,
      targetLat: 21.5 + (Math.random() - 0.5) * 4,
      targetLng: 118.5 + (Math.random() - 0.5) * 5,
    })
  }
  return entities
}

function tick(entities, speedMul) {
  for (let j = 0; j < speedMul; j++) {
    for (const e of entities) {
      const dLat = e.targetLat - e.lat
      const dLng = e.targetLng - e.lng
      const dist = Math.sqrt(dLat * dLat + dLng * dLng)
      if (dist < 0.01) {
        e.targetLat = 21.5 + (Math.random() - 0.5) * 4
        e.targetLng = 118.5 + (Math.random() - 0.5) * 5
      } else {
        const step = (e.speed * 1.852) / 111 / 3600 * 3
        const r = Math.min(step / dist, 1)
        e.lat += dLat * r
        e.lng += dLng * r
        e.heading = (Math.atan2(dLng, dLat) * 180) / Math.PI
      }
    }
  }
}

// ========== HTTP 服务 ==========
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // 健康检查
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', connections }))
    return
  }

  // SSE 实体流
  if (req.url?.startsWith('/api/stream')) {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    const count = parseInt(url.searchParams.get('count') || '50')
    const speedMul = parseInt(url.searchParams.get('speed') || '100')

    console.log(`[SSE] 新连接: ${count}实体 x${speedMul}`)

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    // 发送初始参数
    res.write(`event: init\ndata: ${JSON.stringify({ count, speedMul })}\n\n`)

    const entities = createEntities(count)
    let pushCount = 0
    connections++

    // 高频推送循环：每 5ms 推一批（模拟 gRPC Streaming 效果）
    const interval = setInterval(() => {
      tick(entities, speedMul)
      pushCount++
      const payload = JSON.stringify(entities)
      res.write(`id: ${pushCount}\nevent: entity_update\ndata: ${payload}\n\n`)
    }, 5)

    // 客户端断开
    req.on('close', () => {
      clearInterval(interval)
      connections--
      console.log(`[SSE] 断开: 共推送 ${pushCount} 批`)
    })
    return
  }

  // 404
  res.writeHead(404)
  res.end('Not Found')
})

let connections = 0

server.listen(PORT, () => {
  console.log(`🚀 SSE 仿真推送服务已启动: http://localhost:${PORT}/api/stream?count=50&speed=100`)
  console.log(`   参数: count=实体数量(10-200) speed=推送倍速(10-200)`)
  console.log(`   健康检查: http://localhost:${PORT}/api/health`)
})
