import { useThree } from "@react-three/fiber";
import { useLayoutEffect } from "react";
import * as THREE from "three";
import type { Cam } from "../library/camera";
import type { View } from "../scene/view";
import { W } from "../theme";
import { FOV, PITCH, PX, RAD } from "./world";

/**
 * The 2D camera moves (library/camera.tsx), played by a real camera.
 *
 * A 2D camera is a zoom around a focal point on the 1920×1080 stage, plus a
 * shake, a roll and a motion blur. Here the same numbers place a perspective
 * camera: it looks at the focal point on the stage plane from far enough away
 * that the frame shows exactly what the 2D frame would show at the stage
 * (view height / zoom). So every move, every framing (wide, medium, the 9:16
 * re-layout) and every clamp is the 2D one, and depth comes for free: a push
 * moves the camera in, so the room behind the characters opens up.
 */

export type CamPose = { position: THREE.Vector3; target: THREE.Vector3; roll: number; fov: number };

export function camPose(cam: Cam, view: View, groundY: number): CamPose {
  const visible = view.height / cam.zoom / PX; // metres of stage the frame shows top to bottom
  const dist = visible / 2 / Math.tan((FOV / 2) * RAD);
  // the 2D shake is in screen px: one screen px is 1/zoom stage px
  const sx = cam.shake.x / cam.zoom / PX;
  const sy = cam.shake.y / cam.zoom / PX;
  const target = new THREE.Vector3((cam.f.x - W / 2) / PX + sx, (groundY - cam.f.y) / PX - sy, 0);
  const position = target.clone().add(new THREE.Vector3(0, Math.sin(PITCH * RAD) * dist, Math.cos(PITCH * RAD) * dist));
  return { position, target, roll: -cam.rot * RAD, fov: FOV };
}

/** Puts the canvas's camera where camPose says, before the frame is drawn. */
export function CameraRig({ pose, aspect }: { pose: CamPose; aspect: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useLayoutEffect(() => {
    camera.fov = pose.fov;
    camera.aspect = aspect;
    camera.near = 0.1;
    camera.far = 400;
    camera.position.copy(pose.position);
    camera.up.set(Math.sin(pose.roll), Math.cos(pose.roll), 0);
    camera.lookAt(pose.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  });
  return null;
}
