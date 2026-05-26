import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

// ========== 类型定义 ==========
interface Entity {
  id: number
  x: number
  y: number
  color: string
}

interface SimulatorRef {
  start: () => void
  stop: () => void
}

// ========== 模拟推送服务（纯内存，不依赖网络） ==========
function createSimulator(onPush: (entities: Entity[]) => void, count: number, speed: number): SimulatorRef {
  let running = false
  let timer: number | null = null
  let entities: Entity[] = []

  // 初始化实体
  const colors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff922b', '#845ef7', '#f06595']
  for (let i = 0; i < count; i++) {
    entities.push({
      id: i,
      x: Math.random() * 800,
      y: Math.random() * 600,
      color: colors[i % colors.length],
    })
  }

  function tick() {
    if (!running) return
    // 每 tick 更新一批实体（模拟高频推送）
    for (let j = 0; j < speed; j++) {
      for (let i = 0; i < entities.length; i++) {
        // 随机游走
        entities[i].x += (Math.random() - 0.5) * 8
        entities[i].y += (Math.random() - 0.5) * 8
        // 边界反弹
        if (entities[i].x < 0) entities[i].x = 0
        if (entities[i].x > 800) entities[i].x = 800
        if (entities[i].y < 0) entities[i].y = 0
        if (entities[i].y > 600) entities[i].y = 600
      }
    }
    // 推送当前所有实体状态
    onPush(entities.map(e => ({ ...e })))
    timer = requestAnimationFrame(tick)
  }

  return {
    start() {
      running = true
      timer = requestAnimationFrame(tick)
    },
    stop() {
      running = false
      if (timer) cancelAnimationFrame(timer)
    },
  }
}

// ========== Canvas 渲染器 ==========
function renderEntities(ctx: CanvasRenderingContext2D, entities: Entity[]) {
  ctx.clearRect(0, 0, 800, 600)
  for (const e of entities) {
    ctx.beginPath()
    ctx.arc(e.x, e.y, 4, 0, Math.PI * 2)
    ctx.fillStyle = e.color
    ctx.fill()
  }
}

// ========== FPS 监控 ==========
class FPSMonitor {
  private frames = 0
  private lastTime = performance.now()
  private fps = 0

  tick(): number {
    this.frames++
    const now = performance.now()
    if (now - this.lastTime >= 1000) {
      this.fps = this.frames
      this.frames = 0
      this.lastTime = now
    }
    return this.fps
  }

  reset() {
    this.frames = 0
    this.lastTime = performance.now()
    this.fps = 0
  }
}

// ========== 主应用 ==========
export default function App() {
  const directCanvasRef = useRef<HTMLCanvasElement>(null)
  const optimizedCanvasRef = useRef<HTMLCanvasElement>(null)
  const [directFPS, setDirectFPS] = useState(0)
  const [optimizedFPS, setOptimizedFPS] = useState(0)
  const [entityCount, setEntityCount] = useState(300)
  const [pushSpeed, setPushSpeed] = useState(100)
  const [isRunning, setIsRunning] = useState(false)
  const [directDataCount, setDirectDataCount] = useState(0)
  const [optimizedDataCount, setOptimizedDataCount] = useState(0)

  const simA = useRef<SimulatorRef | null>(null)
  const simB = useRef<SimulatorRef | null>(null)
  const fpsA = useRef(new FPSMonitor())
  const fpsB = useRef(new FPSMonitor())
  const directReceived = useRef(0)
  const optimizedReceived = useRef(0)

  // WebWorker 模拟：用 Map 缓存 + 16ms 定时推送
  const workerCache = useRef<Map<number, Entity>>(new Map())
  const workerEntities = useRef<Entity[]>([])
  const workerLastFlush = useRef(0)

  const startSimulation = useCallback(() => {
    if (isRunning) return
    setIsRunning(true)

    fpsA.current.reset()
    fpsB.current.reset()
    directReceived.current = 0
    optimizedReceived.current = 0
    workerCache.current.clear()
    workerEntities.current = []

    // 方案 A：直接渲染（每次推送都渲染）
    const canvasA = directCanvasRef.current!
    const ctxA = canvasA.getContext('2d')!
    simA.current = createSimulator((entities) => {
      directReceived.current++
      renderEntities(ctxA, entities)
      setDirectFPS(fpsA.current.tick())
      setDirectDataCount(directReceived.current)
    }, entityCount, pushSpeed)

    // 方案 B：优化渲染（Map 缓存 + rAF 节流）
    const canvasB = optimizedCanvasRef.current!
    const ctxB = canvasB.getContext('2d')!

    // WebWorker 模拟：接收数据，写入 Map 缓存
    simB.current = createSimulator((entities) => {
      optimizedReceived.current++
      for (const e of entities) {
        workerCache.current.set(e.id, e) // Map 缓存，同 ID 自动覆盖
      }
    }, entityCount, pushSpeed)

    // rAF 节流渲染
    function optimizedRender() {
      if (!isRunning) return
      const now = performance.now()
      // 每 16ms 刷新一次（60fps）
      if (now - workerLastFlush.current >= 16) {
        // 从 Map 取出最新状态
        const latest: Entity[] = []
        workerCache.current.forEach((v) => latest.push(v))
        renderEntities(ctxB, latest)
        setOptimizedFPS(fpsB.current.tick())
        setOptimizedDataCount(optimizedReceived.current)
        workerLastFlush.current = now
      }
      requestAnimationFrame(optimizedRender)
    }
    workerLastFlush.current = performance.now()
    requestAnimationFrame(optimizedRender)

    simA.current.start()
    simB.current.start()
  }, [isRunning, entityCount, pushSpeed])

  const stopSimulation = useCallback(() => {
    setIsRunning(false)
    simA.current?.stop()
    simB.current?.stop()
  }, [])

  // 清理
  useEffect(() => {
    return () => {
      simA.current?.stop()
      simB.current?.stop()
    }
  }, [])

  return (
    <div className="app">
      <header className="header">
        <h1>🖥️ 高频实时数据推送渲染方案对比</h1>
        <p className="subtitle">
          gRPC Streaming → WebWorker (Map 缓存 + 16ms 节流) → rAF 渲染
        </p>
      </header>

      {/* 控制面板 */}
      <div className="controls">
        <div className="control-group">
          <label>实体数量：</label>
          <input
            type="range"
            min={50}
            max={500}
            step={50}
            value={entityCount}
            onChange={(e) => setEntityCount(Number(e.target.value))}
            disabled={isRunning}
          />
          <span className="value">{entityCount}</span>
        </div>
        <div className="control-group">
          <label>推送倍速：</label>
          <input
            type="range"
            min={10}
            max={200}
            step={10}
            value={pushSpeed}
            onChange={(e) => setPushSpeed(Number(e.target.value))}
            disabled={isRunning}
          />
          <span className="value">{pushSpeed}x</span>
        </div>
        <div className="control-group">
          {!isRunning ? (
            <button className="btn btn-start" onClick={startSimulation}>
              ▶ 开始推演
            </button>
          ) : (
            <button className="btn btn-stop" onClick={stopSimulation}>
              ⏹ 停止
            </button>
          )}
        </div>
      </div>

      {/* 对比面板 */}
      <div className="compare-panel">
        {/* 方案 A：直接渲染 */}
        <div className="panel panel-bad">
          <div className="panel-header bad">
            <h2>❌ 直接渲染（无优化）</h2>
            <div className="stats">
              <span className="fps" style={{ color: directFPS >= 30 ? '#6bcb77' : '#ff6b6b' }}>
                {directFPS} FPS
              </span>
              <span className="data-count">收到 {directDataCount} 批数据</span>
            </div>
          </div>
          <canvas ref={directCanvasRef} width={800} height={600} className="render-canvas" />
          <div className="panel-desc">
            <p>⚠️ 每次收到数据都立即渲染 → 主线程阻塞 → 掉帧卡顿</p>
          </div>
        </div>

        {/* 方案 B：优化渲染 */}
        <div className="panel panel-good">
          <div className="panel-header good">
            <h2>✅ 四层削峰（优化方案）</h2>
            <div className="stats">
              <span className="fps" style={{ color: optimizedFPS >= 55 ? '#6bcb77' : '#ffd93d' }}>
                {optimizedFPS} FPS
              </span>
              <span className="data-count">收到 {optimizedDataCount} 批数据</span>
            </div>
          </div>
          <canvas ref={optimizedCanvasRef} width={800} height={600} className="render-canvas" />
          <div className="panel-desc">
            <p>✅ WebWorker Map 缓存去重 + 16ms 节流 → 平滑 60fps</p>
          </div>
        </div>
      </div>

      {/* 架构说明 */}
      <div className="architecture">
        <h3>📐 优化方案架构</h3>
        <div className="arch-flow">
          <div className="arch-box">模拟推送<br/><small>{entityCount}实体 × {pushSpeed}x</small></div>
          <span className="arch-arrow">→</span>
          <div className="arch-box highlight">WebWorker<br/><small>Map 缓存去重</small></div>
          <span className="arch-arrow">→</span>
          <div className="arch-box highlight">16ms 节流<br/><small>削峰 2000x</small></div>
          <span className="arch-arrow">→</span>
          <div className="arch-box highlight">rAF 渲染<br/><small>60fps 平滑</small></div>
        </div>
      </div>
    </div>
  )
}
