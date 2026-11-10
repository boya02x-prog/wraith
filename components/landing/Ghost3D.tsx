"use client";
// 3D hero: a glowing hooded ghost with the seven chains orbiting it. Loaded only on capable desktop devices.
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Sparkles } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const CHAIN_COLORS = ["#9945ff", "#0052ff", "#627eea", "#f3ba2f", "#836ef9", "#1fb5a8", "#c3f53c"];

function ghostGeometry() {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a) * 0.95, 0.4 + Math.cos(a) * 0.95));
  }
  pts.push(new THREE.Vector2(0.99, -0.2), new THREE.Vector2(1.04, -0.9), new THREE.Vector2(1.06, -1.3));
  const g = new THREE.LatheGeometry(pts, 64);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < -0.85) {
      const ang = Math.atan2(pos.getZ(i), pos.getX(i));
      pos.setY(i, y - 0.05 + Math.sin(ang * 6) * 0.2 * ((-0.85 - y) / 0.45 + 0.35));
    }
  }
  g.computeVertexNormals();
  return g;
}

function Ghost({ pointer }: { pointer: React.MutableRefObject<{ x: number; y: number }> }) {
  const group = useRef<THREE.Group>(null);
  const geo = useMemo(ghostGeometry, []);
  useFrame((s) => {
    const g = group.current;
    if (!g) return;
    const t = s.clock.elapsedTime;
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, pointer.current.x * 0.55 + Math.sin(t * 0.5) * 0.18, 0.06);
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, -pointer.current.y * 0.22, 0.06);
  });
  return (
    <group ref={group}>
      <mesh geometry={geo}>
        <meshStandardMaterial color="#ff7b3d" emissive="#ff4d0d" emissiveIntensity={0.55} roughness={0.38} metalness={0.05} side={THREE.DoubleSide} />
      </mesh>
      {/* hood opening */}
      <mesh position={[0, 0.55, 0.78]} scale={[0.5, 0.62, 0.3]}>
        <sphereGeometry args={[1, 40, 40]} />
        <meshStandardMaterial color="#120905" roughness={0.9} />
      </mesh>
      {/* eyes */}
      {[-0.2, 0.2].map((x) => (
        <mesh key={x} position={[x, 0.55, 1.03]} rotation={[0, 0, x < 0 ? -0.5 : 0.5]} scale={[0.15, 0.055, 0.04]}>
          <sphereGeometry args={[1, 24, 24]} />
          <meshStandardMaterial color="#fff3e8" emissive="#ffd7b5" emissiveIntensity={2.2} />
        </mesh>
      ))}
    </group>
  );
}

function Orbit() {
  const ring = useRef<THREE.Group>(null);
  useFrame((_, dt) => { if (ring.current) ring.current.rotation.y += dt * 0.35; });
  return (
    <group rotation={[0.35, 0, -0.18]}>
      <group ref={ring}>
        {CHAIN_COLORS.map((c, i) => {
          const a = (i / CHAIN_COLORS.length) * Math.PI * 2;
          return (
            <mesh key={c} position={[Math.cos(a) * 2.25, Math.sin(a * 2) * 0.12, Math.sin(a) * 2.25]}>
              <cylinderGeometry args={[0.2, 0.2, 0.06, 40]} />
              <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.7} metalness={0.4} roughness={0.3} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

export default function Ghost3D() {
  const wrap = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.current = { x: ((e.clientX - r.left) / r.width - 0.5) * 2, y: ((e.clientY - r.top) / r.height - 0.5) * 2 };
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => { io.disconnect(); window.removeEventListener("pointermove", move); };
  }, []);

  return (
    <div ref={wrap} className="lp-3d" aria-hidden="true">
      <Canvas
        dpr={[1, 2]}
        frameloop={visible ? "always" : "never"}
        camera={{ position: [0, 0.2, 5.4], fov: 38 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      >
        <ambientLight intensity={0.55} />
        <pointLight position={[3, 3, 4]} intensity={60} color="#ffb27f" />
        <pointLight position={[-4, -1, 2]} intensity={28} color="#ff5a1a" />
        <Float speed={1.4} rotationIntensity={0.15} floatIntensity={0.9}>
          <Ghost pointer={pointer} />
          <Orbit />
        </Float>
        <Sparkles count={42} scale={[7, 5, 4]} size={2.4} speed={0.35} color="#ffb27f" opacity={0.7} />
      </Canvas>
    </div>
  );
}
