"""
FBX -> GLB for the low-poly style's animation clips (Mixamo or other humanoid FBX).

Runs inside Blender (its own bundled Python, nothing to install in the repo):

    blender -b --factory-startup -P remotion/scripts/blender/fbx_to_glb.py -- <in.fbx> <out.glb> [--clip-name walk]

Imports the FBX with its armature and animation, keeps the skeleton and the
action (meshes are dropped unless --keep-mesh), names the action after the clip
and exports a binary glTF with animations, at the FBX's own frame rate. The
bone names stay as Mixamo writes them ("mixamorig:Hips" ...), which is what
remotion/src/three/rig3d.ts names its joints after.

Called by `pnpm assets3d convert` (remotion/scripts/assets3d.ts); usable alone.
"""
import sys

import bpy


def main(argv):
    if len(argv) < 2:
        raise SystemExit("usage: blender -b -P fbx_to_glb.py -- in.fbx out.glb [--clip-name NAME] [--keep-mesh]")
    src, dst = argv[0], argv[1]
    clip = argv[argv.index("--clip-name") + 1] if "--clip-name" in argv else None
    keep_mesh = "--keep-mesh" in argv

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=src, automatic_bone_orientation=False, ignore_leaf_bones=True)

    arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if not arms:
        raise SystemExit(f"{src}: no armature in this FBX")
    if not keep_mesh:
        for o in list(bpy.context.scene.objects):
            if o.type == "MESH":
                bpy.data.objects.remove(o, do_unlink=True)

    actions = list(bpy.data.actions)
    if clip and actions:
        actions[0].name = clip
    frames = [int(a.frame_range[1] - a.frame_range[0]) for a in actions]

    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format="GLB",
        export_animations=True,
        export_skins=keep_mesh,
        export_morph=False,
        export_force_sampling=True,
        export_frame_step=1,
    )
    print(f"ok {src} -> {dst} armature={arms[0].name} bones={len(arms[0].data.bones)} actions={[a.name for a in actions]} frames={frames}")


main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
