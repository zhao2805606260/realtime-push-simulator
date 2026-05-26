import { useState, useRef, useCallback, useEffect } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

// ========== 类型 ==========
interface Entity {
  id: number; lat: number; lng: number; heading: number
  speed: number; icon: string; type: string; targetLat: number; targetLng: number
}

const TYPES = [
  { icon: '🛩️', type: '战斗机', speed: 800 },
  { icon: '🚁', type: '直升机', speed: 250 },
  { icon: '🚢', type: '驱逐舰', speed: 30 },
  { icon: '🚛', type: '装甲车', speed: 70 },
  { icon: '🎯', type: '导弹', speed: 2500 },
]
const CENTER: [number, number] = [21.5, 118.5]
const randPos = () => ({ lat: CENTER[0] + (Math.random() - 0.5) * 4, lng: CENTER[1] + (Math.random() - 0.5) * 5 })
const milIcon = (e: string) => L.divIcon({ html: `<div style="font-size:22px">${e}</div>`, className: 'mil-marker', iconSize: [30,30], iconAnchor: [15,15] })

// ========== 引擎 ==========
function createEngine(count: number, mul: number) {
  const entities: Entity[] = []
  for (let i = 0; i < count; i++) {
    const t = TYPES[i % TYPES.length], p = randPos()
    entities.push({ id: i, lat: p.lat, lng: p.lng, heading: 0, speed: t.speed, icon: t.icon, type: t.type, targetLat: randPos().lat, targetLng: randPos().lng })
  }
  let running = false, raf = 0
  function tick() {
    if (!running) return
    for (let j = 0; j < mul; j++) for (const e of entities) {
      const dLat = e.targetLat - e.lat, dLng = e.targetLng - e.lng, dist = Math.sqrt(dLat * dLat + dLng * dLng)
      if (dist < 0.01) { const np = randPos(); e.targetLat = np.lat; e.targetLng = np.lng }
      else { const r = Math.min((e.speed * 1.852) / 111 / 3600 * 3 / dist, 1); e.lat += dLat * r; e.lng += dLng * r; e.heading = (Math.atan2(dLng, dLat) * 180) / Math.PI }
    }
    raf = requestAnimationFrame(tick)
  }
  return { entities, start() { running = true; raf = requestAnimationFrame(tick) }, stop() { running = false; cancelAnimationFrame(raf) }, getSnapshot: () => entities.map(e => ({ ...e })) }
}

// ========== FPS ==========
class FPS { v = 0; private c = 0; private t = performance.now()
  tick() { this.c++; const n = performance.now(); if (n - this.t >= 1000) { this.v = this.c; this.c = 0; this.t = n } return this.v }
  reset() { this.v = 0; this.c = 0; this.t = performance.now() }
}

// ========== 左侧：直接渲染 — 每帧强制 React re-render + 全量 setLatLng ==========
function DirectMap({ engine }: { engine: ReturnType<typeof createEngine> }) {
  const mapRef = useRef<L.Map | null>(null)
  const mk = useRef<Map<number, L.Marker>>(new Map())
  const fps = useRef(new FPS())
  const [, rr] = useState(0)
  const fpsSpan = useRef<HTMLSpanElement | null>(null)

  function Init() { const m = useMap(); useEffect(() => { mapRef.current = m }, [m]); return null }

  useEffect(() => {
    const m = mapRef.current; if (!m) return
    const loop = () => {
      const snap = engine.getSnapshot()
      const exist = new Set(mk.current.keys()), want = new Set(snap.map(e => e.id))
      for (const id of exist) { if (!want.has(id)) { mk.current.get(id)?.remove(); mk.current.delete(id) } }
      for (const e of snap) {
        let marker = mk.current.get(e.id)
        if (marker) marker.setLatLng([e.lat, e.lng])
        else { marker = L.marker([e.lat, e.lng], { icon: milIcon(e.icon) }).addTo(m); mk.current.set(e.id, marker) }
      }
      fps.current.tick()
      if (fpsSpan.current) fpsSpan.current.textContent = fps.current.v + ' FPS'
      rr(n => n + 1) // 每帧强制 re-render
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }, [])
  return <><Init /><div className="fps-overlay bad"><span ref={fpsSpan}>0 FPS</span></div></>
}

// ========== 右侧：优化 — Map 缓存 + 16ms 节流，完全绕过 React ==========
function OptimizedMap({ engine }: { engine: ReturnType<typeof createEngine> }) {
  const mapRef = useRef<L.Map | null>(null)
  const mk = useRef<Map<number, L.Marker>>(new Map())
  const cache = useRef<Map<number, Entity>>(new Map())
  const fps = useRef(new FPS())
  const last = useRef(0)
  const pushCnt = useRef(0)
  const fpsSpan = useRef<HTMLSpanElement | null>(null)
  const pushSpan = useRef<HTMLSpanElement | null>(null)

  function Init() { const m = useMap(); useEffect(() => { mapRef.current = m }, [m]); return null }

  useEffect(() => {
    const m = mapRef.current; if (!m) return

    // 线程1：高频读引擎 → 写缓存
    const reader = () => {
      const snap = engine.getSnapshot(); pushCnt.current++
      for (const e of snap) cache.current.set(e.id, e)
      if (pushSpan.current) pushSpan.current.textContent = `收 ${pushCnt.current} 批`
      requestAnimationFrame(reader)
    }
    requestAnimationFrame(reader)

    // 线程2：每 16ms 从缓存取最新 → 更新 marker
    const flusher = () => {
      const now = performance.now()
      if (now - last.current >= 16) {
        last.current = now
        const c = cache.current; const exist = new Set(mk.current.keys()), want = new Set(c.keys())
        for (const id of exist) { if (!want.has(id)) { mk.current.get(id)?.remove(); mk.current.delete(id) } }
        c.forEach((e, id) => {
          let marker = mk.current.get(id)
          if (marker) marker.setLatLng([e.lat, e.lng])
          else { marker = L.marker([e.lat, e.lng], { icon: milIcon(e.icon) }).addTo(m); mk.current.set(id, marker) }
        })
        fps.current.tick()
        if (fpsSpan.current) fpsSpan.current.textContent = fps.current.v + ' FPS'
      }
      requestAnimationFrame(flusher)
    }
    requestAnimationFrame(flusher)
  }, [])
  return <><Init /><div className="fps-overlay good"><span ref={fpsSpan}>0 FPS</span><span className="push-count" ref={pushSpan}>收 0 批</span></div></>
}

// ========== App ==========
export default function App() {
  const [n, setN] = useState(50); const [spd, setSpd] = useState(100); const [run, setRun] = useState(false)
  const eA = useRef<ReturnType<typeof createEngine> | null>(null); const eB = useRef<ReturnType<typeof createEngine> | null>(null)

  const start = useCallback(() => { if (run) return; setRun(true); eA.current = createEngine(n, spd); eB.current = createEngine(n, spd); eA.current.start(); eB.current.start() }, [run, n, spd])
  const stop = useCallback(() => { setRun(false); eA.current?.stop(); eB.current?.stop() }, [])
  useEffect(() => () => { eA.current?.stop(); eB.current?.stop() }, [])

  return (
    <div className="app">
      <header className="header"><h1>🖥️ 军事仿真高频数据推送渲染对比</h1><p className="subtitle">南海区域 · {n}实体 × {spd}x · 同一引擎不同渲染策略</p></header>
      <div className="controls">
        <div className="control-group"><label>实体：</label><input type="range" min={10} max={200} step={10} value={n} onChange={e => setN(+e.target.value)} disabled={run} /><span className="value">{n}</span></div>
        <div className="control-group"><label>倍速：</label><input type="range" min={10} max={200} step={10} value={spd} onChange={e => setSpd(+e.target.value)} disabled={run} /><span className="value">{spd}x</span></div>
        {!run ? <button className="btn btn-start" onClick={start}>▶ 开始推演</button> : <button className="btn btn-stop" onClick={stop}>⏹ 停止</button>}
      </div>
      <div className="compare-panel">
        <div className="panel panel-bad">
          <div className="panel-header bad"><h2>❌ 直接渲染</h2><span className="desc-text">每帧 setLatLng 全量更新 + React re-render</span></div>
          <div className="map-wrapper">
            {run && eA.current ? <MapContainer center={CENTER} zoom={8} className="leaflet-map" zoomControl={false} attributionControl={false}><TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" /><DirectMap engine={eA.current} /></MapContainer>
              : <div className="map-placeholder">点击「开始推演」启动</div>}
          </div>
        </div>
        <div className="panel panel-good">
          <div className="panel-header good"><h2>✅ 四层削峰</h2><span className="desc-text">Map 缓存 + 16ms 节流 · 完全绕过 React</span></div>
          <div className="map-wrapper">
            {run && eB.current ? <MapContainer center={CENTER} zoom={8} className="leaflet-map" zoomControl={false} attributionControl={false}><TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" /><OptimizedMap engine={eB.current} /></MapContainer>
              : <div className="map-placeholder">点击「开始推演」启动</div>}
          </div>
        </div>
      </div>
      <div className="legend">{TYPES.map(t => <div key={t.type} className="legend-item"><span className="legend-icon">{t.icon}</span><span>{t.type}</span><span className="legend-speed">{t.speed}节</span></div>)}</div>
      <div className="architecture"><h3>📐 两侧差异</h3><div className="arch-flow"><div className="arch-box bad-box">左侧<small>每帧React re-render<br/>+全量setLatLng</small></div><span className="arch-arrow">vs</span><div className="arch-box good-box">右侧<small>Map缓存写入<br/>16ms刷新到Marker<br/>0次React re-render</small></div></div></div>
    </div>
  )
}
