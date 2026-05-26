// WebWorker: 接收实体快照 → Map 缓存去重 → 16ms 定时推送最新状态

interface Entity {
  id: number; lat: number; lng: number; heading: number
  speed: number; icon: string; type: string; targetLat: number; targetLng: number
}

const cache = new Map<number, Entity>()
let lastFlush = 0
let flushTimer: ReturnType<typeof setInterval> | null = null
let pushCount = 0
let flushCount = 0

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data

  switch (type) {
    case 'snapshot': {
      // 接收主线程推送的实体快照，写入 Map 缓存（同 ID 自动覆盖）
      const entities: Entity[] = payload
      pushCount++
      for (const entity of entities) {
        cache.set(entity.id, entity)
      }
      break
    }

    case 'start': {
      // 启动 16ms 定时刷新
      pushCount = 0
      flushCount = 0
      if (flushTimer) clearInterval(flushTimer)

      flushTimer = setInterval(() => {
        if (cache.size === 0) return
        flushCount++

        // 取出所有缓存中最新的实体状态
        const latest: Entity[] = []
        cache.forEach((e) => latest.push(e))

        // 发送给主线程（Transferable 会在真实场景用，这里简化）
        self.postMessage({
          type: 'flush',
          payload: latest,
          pushCount,
          flushCount,
        })
      }, 16) // 16ms = 约 60fps
      break
    }

    case 'stop': {
      if (flushTimer) {
        clearInterval(flushTimer)
        flushTimer = null
      }
      break
    }

    case 'ping': {
      self.postMessage({ type: 'pong', id: payload })
      break
    }
  }
}
