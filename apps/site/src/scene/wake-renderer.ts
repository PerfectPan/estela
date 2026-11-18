// Loaded with a dynamic import only when WebGL is available and motion is allowed; nothing here runs on the server.
import type { OGLRenderingContext } from 'ogl'
import { Box, Camera, Mesh, Plane, Program, Renderer, Transform, Vec3 } from 'ogl'
import type { ScenePalette } from './scene-palette.ts'
import type { Anchor, Instance, WakeLayout } from './wake-instances.ts'
import { readPalette } from './scene-palette.ts'
import { GROW_SECONDS } from './wake-instances.ts'

export interface ScreenPoint {
  x: number
  y: number
}

export interface WakeRendererOptions {
  canvas: HTMLCanvasElement
  /** The element whose size, visibility, and scroll position drive the scene. */
  host: HTMLElement
  layout: WakeLayout
  /** Called after each drawn frame with the anchors in CSS pixels relative to the host. */
  onAnchors: (points: Record<Anchor['id'], ScreenPoint>) => void
  /** Called once, after the first frame is on screen. */
  onReady: () => void
  /** Called when the browser drops the WebGL context (a GPU reset, a backgrounded mobile tab). */
  onLost: () => void
}

const BOX_VERTEX = /* glsl */ `
attribute vec3 position;
attribute vec3 normal;
attribute vec3 offset;
attribute vec3 size;
attribute vec3 color;
attribute float delay;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
uniform float uGrow;
varying vec3 vNormal;
varying vec3 vColor;
varying float vLevel;
varying float vDepth;
void main() {
  float t = clamp((uTime - delay) / uGrow, 0.0, 1.0);
  float grown = 1.0 - pow(1.0 - t, 3.0);
  vec3 p = position + vec3(0.0, 0.5, 0.0);
  vec3 world = vec3(offset.x + p.x * size.x, (offset.y + p.y * size.y) * grown, offset.z + p.z * size.z);
  vNormal = normal;
  vColor = color;
  vLevel = p.y;
  vec4 view = modelViewMatrix * vec4(world, 1.0);
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}`

const BOX_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec3 uBackground;
uniform vec2 uFog;
uniform float uAlpha;
varying vec3 vNormal;
varying vec3 vColor;
varying float vLevel;
varying float vDepth;
void main() {
  vec3 light = normalize(vec3(0.45, 0.8, 0.4));
  float diffuse = max(dot(vNormal, light), 0.0);
  float top = step(0.5, vNormal.y);
  vec3 color = vColor * (0.7 + 0.42 * diffuse);
  color *= mix(0.78, 1.0, vLevel);
  color = mix(color, min(vColor * 1.22, vec3(1.0)), top * 0.5);
  float fog = smoothstep(uFog.x, uFog.y, vDepth);
  gl_FragColor = vec4(mix(color, uBackground, fog), uAlpha);
}`

const FLOOR_VERTEX = /* glsl */ `
attribute vec3 position;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
varying vec3 vWorld;
varying float vDepth;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}`

const FLOOR_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec3 uGrid;
uniform vec3 uAxis;
uniform vec2 uFog;
uniform vec2 uExtent;
varying vec3 vWorld;
varying float vDepth;
float line(float coord, float spacing, float width) {
  float d = abs(fract(coord / spacing - 0.5) - 0.5) * spacing;
  return 1.0 - smoothstep(width, width * 2.5, d);
}
void main() {
  float ticks = line(vWorld.x, 1.0, 0.012) * 0.55 + line(vWorld.z, 1.0, 0.012) * 0.3;
  float axis = (1.0 - smoothstep(0.0, 0.03, abs(vWorld.z))) * step(-0.3, vWorld.x) * step(vWorld.x, uExtent.x + 0.3);
  float fog = 1.0 - smoothstep(uFog.x, uFog.y, vDepth);
  float edge = 1.0 - smoothstep(uExtent.y * 0.4, uExtent.y, length(vWorld.xz - vec2(uExtent.x * 0.5, 0.0)));
  float alpha = max(ticks * 0.5, axis * 0.9) * fog * edge;
  gl_FragColor = vec4(mix(uGrid, uAxis, axis), alpha);
}`

function instancedBoxes(gl: OGLRenderingContext, instances: Instance[]) {
  const offset = new Float32Array(instances.length * 3)
  const size = new Float32Array(instances.length * 3)
  const delay = new Float32Array(instances.length)
  instances.forEach((instance, i) => {
    offset.set([instance.x, instance.y, instance.z], i * 3)
    size.set([instance.width, instance.height, instance.depth], i * 3)
    delay[i] = instance.delay
  })
  return new Box(gl, {
    attributes: {
      offset: { instanced: 1, size: 3, data: offset },
      size: { instanced: 1, size: 3, data: size },
      color: { instanced: 1, size: 3, data: new Float32Array(instances.length * 3) },
      delay: { instanced: 1, size: 1, data: delay },
    },
  })
}

function paint(geometry: Box, instances: Instance[], palette: ScenePalette) {
  const color = geometry.attributes.color!
  const data = color.data as Float32Array
  instances.forEach((instance, i) => data.set(palette.roles[instance.role], i * 3))
  color.needsUpdate = true
}

/** Starts the hero scene. Returns `undefined` when no WebGL context can be created. */
export function createWakeRenderer(options: WakeRendererOptions): { dispose: () => void } | undefined {
  const { canvas, host, layout } = options
  // Probe first: OGL logs a console error when it gets no context. Its own getContext call later returns this
  // context, so the attributes match the ones it asks for.
  const attributes = { alpha: true, antialias: true, premultipliedAlpha: false }
  if (!(canvas.getContext('webgl2', attributes) ?? canvas.getContext('webgl', attributes))) {
    return undefined
  }
  let renderer: Renderer
  try {
    renderer = new Renderer({ canvas, dpr: Math.min(window.devicePixelRatio, 2), alpha: true, antialias: true })
  } catch {
    return undefined
  }
  const gl = renderer.gl
  gl.clearColor(0, 0, 0, 0)
  const onContextLost = () => options.onLost()
  canvas.addEventListener('webglcontextlost', onContextLost)

  const camera = new Camera(gl, { fov: 28, near: 0.1, far: 120 })
  const scene = new Transform()
  const extent = layout.center[0] * 2
  const fog = { value: [16, 42] }
  const time = { value: 0 }
  const background = { value: [0, 0, 0] }

  const solidGeometry = instancedBoxes(gl, layout.solid)
  const solidProgram = new Program(gl, {
    vertex: BOX_VERTEX,
    fragment: BOX_FRAGMENT,
    uniforms: { uTime: time, uGrow: { value: GROW_SECONDS }, uBackground: background, uFog: fog, uAlpha: { value: 1 } },
  })
  // Instances sit far from the unit box OGL would cull by, so culling is off for both instanced meshes.
  new Mesh(gl, { geometry: solidGeometry, program: solidProgram, frustumCulled: false }).setParent(scene)

  const glassGeometry = instancedBoxes(gl, layout.glass)
  const glassProgram = new Program(gl, {
    vertex: BOX_VERTEX,
    fragment: BOX_FRAGMENT,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: time,
      uGrow: { value: GROW_SECONDS },
      uBackground: background,
      uFog: fog,
      uAlpha: { value: 0.2 },
    },
  })
  new Mesh(gl, { geometry: glassGeometry, program: glassProgram, frustumCulled: false }).setParent(scene)

  const grid = { value: [0, 0, 0] }
  const axis = { value: [0, 0, 0] }
  const floor = new Mesh(gl, {
    geometry: new Plane(gl, { width: extent + 40, height: 40 }),
    program: new Program(gl, {
      vertex: FLOOR_VERTEX,
      fragment: FLOOR_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: { uGrid: grid, uAxis: axis, uFog: fog, uExtent: { value: [extent, 14] } },
    }),
  })
  floor.rotation.x = -Math.PI / 2
  floor.position.set(layout.center[0], -0.001, 0)
  floor.setParent(scene)

  const applyPalette = () => {
    const palette = readPalette(name => getComputedStyle(document.documentElement).getPropertyValue(name))
    paint(solidGeometry, layout.solid, palette)
    paint(glassGeometry, layout.glass, palette)
    background.value = palette.background
    grid.value = palette.grid
    axis.value = palette.roles.rule
  }
  applyPalette()
  // Fumadocs' next-themes toggles the `dark` class on <html>.
  const themeObserver = new MutationObserver(applyPalette)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

  let width = 1
  let height = 1
  const resize = () => {
    width = Math.max(host.clientWidth, 1)
    height = Math.max(host.clientHeight, 1)
    renderer.setSize(width, height)
    camera.perspective({ aspect: width / height })
  }
  resize()
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host)

  // Pointer parallax, eased toward the target each frame.
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
  const onPointer = (event: PointerEvent) => {
    pointer.tx = (event.clientX / window.innerWidth) * 2 - 1
    pointer.ty = (event.clientY / window.innerHeight) * 2 - 1
  }
  window.addEventListener('pointermove', onPointer, { passive: true })

  // Drawing stops while the hero is scrolled away or the tab is hidden.
  let visible = true
  const canDraw = () => visible && document.visibilityState === 'visible'

  const target = new Vec3(layout.center[0] + 1.8, 2.4, 0.8)
  const anchorPoint = new Vec3()
  const anchors = {} as Record<Anchor['id'], ScreenPoint>
  let frame = 0
  let start = 0
  let ready = false

  const draw = (now: number) => {
    frame = 0
    if (!start) {
      start = now
    }
    time.value = (now - start) / 1000
    pointer.x += (pointer.tx - pointer.x) * 0.05
    pointer.y += (pointer.ty - pointer.y) * 0.05
    const rect = host.getBoundingClientRect()
    const scrolled = Math.min(Math.max(-rect.top / Math.max(rect.height, 1), 0), 1)
    const sway = Math.sin(time.value * 0.18) * 0.04
    const azimuth = 0.42 + pointer.x * 0.1 + sway - scrolled * 0.25
    const elevation = 0.5 - pointer.y * 0.05 + scrolled * 0.3
    // A portrait canvas needs the camera further back to keep the whole session in frame.
    const distance = (32 + scrolled * 6) * (width < height * 1.1 ? 1.45 : 1)
    // Fog starts just past the target, so the oldest requests fade into the background.
    fog.value = [distance - 2, distance + 24]
    camera.position.set(
      target.x + Math.sin(azimuth) * Math.cos(elevation) * distance,
      target.y + Math.sin(elevation) * distance,
      target.z + Math.cos(azimuth) * Math.cos(elevation) * distance,
    )
    camera.lookAt(target)
    renderer.render({ scene, camera })

    for (const anchor of layout.anchors) {
      anchorPoint.set(...anchor.position)
      camera.project(anchorPoint)
      anchors[anchor.id] = { x: (anchorPoint.x * 0.5 + 0.5) * width, y: (0.5 - anchorPoint.y * 0.5) * height }
    }
    options.onAnchors(anchors)
    if (!ready) {
      ready = true
      options.onReady()
    }
    if (canDraw()) {
      frame = requestAnimationFrame(draw)
    }
  }

  const schedule = () => {
    if (!frame && canDraw()) {
      frame = requestAnimationFrame(draw)
    }
  }
  const visibility = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting)
    schedule()
  })
  visibility.observe(host)
  document.addEventListener('visibilitychange', schedule)
  schedule()

  return {
    dispose() {
      cancelAnimationFrame(frame)
      frame = 0
      visible = false
      themeObserver.disconnect()
      resizeObserver.disconnect()
      visibility.disconnect()
      window.removeEventListener('pointermove', onPointer)
      document.removeEventListener('visibilitychange', schedule)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
