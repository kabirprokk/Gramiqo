#!/usr/bin/env python3
"""
Gramiqo 3D Asset Generator
Generates high-quality procedural 3D models for the project:
- Trees (Oak, Pine, Palm, Birch, Willow, Dead)
- Grass (short, medium, tall, wild)
- Terrain (flat, hilly, rocky)
- Rocks (small, medium, large boulder)
- Vegetation (bush, flowers, stump, log)
"""

import numpy as np
import trimesh
import os
import json
from pathlib import Path

# ============================================================
# UTILITY FUNCTIONS
# ============================================================

def create_cylinder(radius_bottom, radius_top, height, segments=16):
    """Create a cylinder mesh."""
    angles = np.linspace(0, 2*np.pi, segments, endpoint=False)
    
    vertices = []
    # Bottom center
    vertices.append([0, 0, 0])
    # Bottom ring
    for a in angles:
        vertices.append([radius_bottom * np.cos(a), radius_bottom * np.sin(a), 0])
    # Top center
    vertices.append([0, 0, height])
    # Top ring
    for a in angles:
        vertices.append([radius_top * np.cos(a), radius_top * np.sin(a), height])
    
    faces = []
    n = segments
    # Bottom cap
    for i in range(1, n+1):
        faces.append([0, i+1 if i < n else 1, i])
    # Top cap
    top_center = n + 1
    for i in range(n+2, 2*n+2):
        faces.append([top_center, i, i+1 if i < 2*n+1 else n+2])
    # Side faces
    for i in range(1, n+1):
        next_i = i + 1 if i < n else 1
        faces.append([i, next_i, next_i + n + 1])
        faces.append([i, next_i + n + 1, i + n + 1])
    
    return trimesh.Trimesh(vertices=np.array(vertices), faces=np.array(faces))


def create_uv_sphere(radius, rings=12, sectors=16):
    """Create a UV sphere."""
    vertices = []
    faces = []
    
    for r in range(rings + 1):
        phi = np.pi * r / rings
        for s in range(sectors):
            theta = 2 * np.pi * s / sectors
            x = radius * np.sin(phi) * np.cos(theta)
            y = radius * np.sin(phi) * np.sin(theta)
            z = radius * np.cos(phi)
            vertices.append([x, y, z])
    
    for r in range(rings):
        for s in range(sectors):
            curr = r * sectors + s
            next_s = r * sectors + (s + 1) % sectors
            below = (r + 1) * sectors + s
            below_next = (r + 1) * sectors + (s + 1) % sectors
            
            if r > 0:
                faces.append([curr, below, next_s])
            if r < rings - 1:
                faces.append([next_s, below, below_next])
    
    return trimesh.Trimesh(vertices=np.array(vertices), faces=np.array(faces))


def create_cone(radius, height, segments=16):
    """Create a cone mesh."""
    vertices = [[0, 0, 0]]
    angles = np.linspace(0, 2*np.pi, segments, endpoint=False)
    for a in angles:
        vertices.append([radius * np.cos(a), radius * np.sin(a), 0])
    vertices.append([0, 0, height])
    
    faces = []
    tip = len(vertices) - 1
    for i in range(1, segments + 1):
        next_i = i + 1 if i < segments else 1
        faces.append([0, next_i, i])
        faces.append([i, next_i, tip])
    
    return trimesh.Trimesh(vertices=np.array(vertices), faces=np.array(faces))


def create_icosphere(subdivisions=2, radius=1.0):
    """Create an icosphere by subdividing an icosahedron."""
    t = (1 + np.sqrt(5)) / 2
    
    verts_list = [
        [-1,  t,  0], [ 1,  t,  0], [-1, -t,  0], [ 1, -t,  0],
        [ 0, -1,  t], [ 0,  1,  t], [ 0, -1, -t], [ 0,  1, -t],
        [ t,  0, -1], [ t,  0,  1], [-t,  0, -1], [-t,  0,  1],
    ]
    
    verts = np.array(verts_list, dtype=float)
    verts = verts / np.linalg.norm(verts[0]) * radius
    
    faces = [
        [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
        [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
        [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
        [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
    ]
    
    for _ in range(subdivisions):
        new_faces = []
        midpoint_cache = {}
        verts = np.array(verts_list)
        
        def get_midpoint(i1, i2):
            key = (min(i1,i2), max(i1,i2))
            if key in midpoint_cache:
                return midpoint_cache[key]
            mid = (verts_list[i1] + verts_list[i2]) / 2
            mid = mid / np.linalg.norm(mid) * radius
            idx = len(verts_list)
            verts_list.append(mid.tolist())
            midpoint_cache[key] = idx
            return idx
        
        for face in faces:
            a, b, c = face
            ab = get_midpoint(a, b)
            bc = get_midpoint(b, c)
            ca = get_midpoint(c, a)
            new_faces.extend([
                [a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]
            ])
        faces = new_faces
    
    return trimesh.Trimesh(vertices=np.array(verts_list), faces=np.array(faces))


def add_noise_to_mesh(mesh, amount=0.02):
    """Add subtle noise to mesh vertices for organic look."""
    mesh.vertices += np.random.normal(0, amount, mesh.vertices.shape)
    mesh.fix_normals()
    return mesh


def color_mesh(mesh, color):
    """Apply a solid color to mesh (RGBA 0-255)."""
    mesh.visual.vertex_colors = np.tile(color, (len(mesh.vertices), 1)).astype(np.uint8)
    return mesh


def combine_meshes(meshes):
    """Combine multiple meshes into one."""
    return trimesh.util.concatenate(meshes)


# ============================================================
# TREE GENERATORS
# ============================================================

def generate_oak_tree():
    """Generate a realistic oak tree with thick trunk and rounded canopy."""
    meshes = []
    
    # Trunk - thick and slightly curved
    trunk = create_cylinder(0.15, 0.2, 2.5, 12)
    trunk.vertices += np.random.normal(0, 0.01, trunk.vertices.shape)
    color_mesh(trunk, [80, 50, 20, 255])
    meshes.append(trunk)
    
    # Main branches
    for i in range(5):
        angle = (i / 5) * 2 * np.pi + np.random.uniform(-0.3, 0.3)
        branch = create_cylinder(0.04, 0.08, 1.2, 8)
        rot = trimesh.transformations.rotation_matrix(np.pi/4 + np.random.uniform(-0.2, 0.2), [0,1,0])
        branch.apply_transform(rot)
        rot2 = trimesh.transformations.rotation_matrix(angle, [0,0,1])
        branch.apply_transform(rot2)
        branch.apply_translation([0, 0, 2.2])
        color_mesh(branch, [90, 55, 25, 255])
        meshes.append(branch)
    
    # Canopy - multiple overlapping spheres for fullness
    canopy_colors = [
        [35, 100, 25, 255], [40, 110, 30, 255], [30, 90, 20, 255],
        [45, 105, 35, 255], [38, 95, 28, 255]
    ]
    
    # Main canopy mass
    for i in range(8):
        r = np.random.uniform(0.6, 1.0)
        sphere = create_uv_sphere(r, 8, 12)
        offset = np.array([
            np.random.uniform(-0.8, 0.8),
            np.random.uniform(-0.8, 0.8),
            np.random.uniform(2.8, 3.8)
        ])
        sphere.apply_translation(offset)
        color_mesh(sphere, canopy_colors[i % len(canopy_colors)])
        add_noise_to_mesh(sphere, 0.03)
        meshes.append(sphere)
    
    # Top crown
    crown = create_uv_sphere(0.7, 8, 12)
    crown.apply_translation([0, 0, 4.0])
    color_mesh(crown, [38, 108, 28, 255])
    meshes.append(crown)
    
    tree = combine_meshes(meshes)
    return tree


def generate_pine_tree():
    """Generate a conifer/pine tree with layered cones."""
    meshes = []
    
    # Trunk - straight and tall
    trunk = create_cylinder(0.08, 0.12, 4.0, 8)
    color_mesh(trunk, [100, 60, 25, 255])
    meshes.append(trunk)
    
    # Layered foliage cones (bottom to top)
    layers = 5
    for i in range(layers):
        t = i / layers
        radius = 1.2 * (1 - t * 0.7)
        height = 1.0
        cone = create_cone(radius, height, 12)
        z = 1.5 + i * 0.8
        
        # Slight random offset for natural look
        offset = np.array([np.random.uniform(-0.05, 0.05), np.random.uniform(-0.05, 0.05), z])
        cone.apply_translation(offset)
        
        green_shade = int(60 + np.random.uniform(-10, 10))
        color_mesh(cone, [20, green_shade, 15, 255])
        add_noise_to_mesh(cone, 0.02)
        meshes.append(cone)
    
    # Top point
    top = create_cone(0.15, 0.5, 8)
    top.apply_translation([0, 0, 4.0])
    color_mesh(top, [15, 55, 10, 255])
    meshes.append(top)
    
    tree = combine_meshes(meshes)
    return tree


def generate_palm_tree():
    """Generate a tropical palm tree."""
    meshes = []
    
    # Trunk - curved and textured
    segments = 8
    for i in range(segments):
        t = i / segments
        r = 0.12 - t * 0.03
        h = 0.5
        seg = create_cylinder(r, r - 0.01, h, 8)
        # Curve the trunk
        curve_x = 0.1 * np.sin(t * np.pi * 0.5)
        seg.apply_translation([curve_x, 0, i * 0.5])
        color_mesh(seg, [140, 100, 50, 255])
        meshes.append(seg)
    
    # Trunk rings (texture detail)
    for i in range(segments * 2):
        ring = create_cylinder(0.13, 0.13, 0.02, 12)
        ring.apply_translation([0.05 * np.sin((i/segments/2) * np.pi * 0.5), 0, i * 0.25])
        color_mesh(ring, [120, 85, 40, 255])
        meshes.append(ring)
    
    # Palm fronds (leaves)
    trunk_top = segments * 0.5
    num_fronds = 8
    for i in range(num_fronds):
        angle = (i / num_fronds) * 2 * np.pi
        # Create elongated leaf shape
        leaf_verts = []
        for j in range(10):
            t = j / 9
            width = 0.3 * np.sin(t * np.pi) * (1 - t * 0.3)
            leaf_verts.append([t * 2.0, -width, 0])
        for j in range(9, -1, -1):
            t = j / 9
            width = 0.3 * np.sin(t * np.pi) * (1 - t * 0.3)
            leaf_verts.append([t * 2.0, width, 0])
        
        leaf_faces = []
        for j in range(9):
            leaf_faces.append([j, j+1, 19-j])
            leaf_faces.append([j+1, 20-j, 19-j])
        
        leaf = trimesh.Trimesh(vertices=np.array(leaf_verts), faces=np.array(leaf_faces))
        
        # Rotate and position
        rot = trimesh.transformations.rotation_matrix(angle, [0,0,1])
        leaf.apply_transform(rot)
        tilt = trimesh.transformations.rotation_matrix(np.pi/3, [0,1,0])
        leaf.apply_transform(tilt)
        leaf.apply_translation([0, 0, trunk_top])
        
        color_mesh(leaf, [30, 120, 20, 255])
        meshes.append(leaf)
    
    # Coconuts
    for i in range(3):
        coconut = create_uv_sphere(0.08, 6, 8)
        a = (i / 3) * 2 * np.pi
        coconut.apply_translation([0.15 * np.cos(a), 0.15 * np.sin(a), trunk_top - 0.2])
        color_mesh(coconut, [100, 60, 20, 255])
        meshes.append(coconut)
    
    tree = combine_meshes(meshes)
    return tree


def generate_birch_tree():
    """Generate an elegant birch tree with white bark and small leaves."""
    meshes = []
    
    # Trunk - slender with white bark
    trunk = create_cylinder(0.06, 0.1, 3.5, 10)
    # Add slight bend
    for i, v in enumerate(trunk.vertices):
        trunk.vertices[i][0] += 0.05 * np.sin(v[2] / 3.5 * np.pi)
    color_mesh(trunk, [220, 215, 200, 255])
    meshes.append(trunk)
    
    # Black bark markings
    for i in range(6):
        mark = create_cylinder(0.065, 0.065, 0.05, 8)
        z = 0.5 + i * 0.5
        mark.apply_translation([0.02 * np.sin(z), 0.02 * np.cos(z), z])
        color_mesh(mark, [40, 35, 30, 255])
        meshes.append(mark)
    
    # Branches - thin and elegant
    for i in range(7):
        angle = (i / 7) * 2 * np.pi + np.random.uniform(-0.2, 0.2)
        length = np.random.uniform(0.5, 1.0)
        branch = create_cylinder(0.015, 0.03, length, 6)
        
        tilt = trimesh.transformations.rotation_matrix(np.pi/3 + np.random.uniform(-0.3, 0.3), [0,1,0])
        branch.apply_transform(tilt)
        rot = trimesh.transformations.rotation_matrix(angle, [0,0,1])
        branch.apply_transform(rot)
        
        z = 2.0 + np.random.uniform(0, 1.0)
        branch.apply_translation([0, 0, z])
        color_mesh(branch, [200, 195, 180, 255])
        meshes.append(branch)
    
    # Small leaf clusters
    leaf_color = [60, 140, 40, 255]
    for i in range(12):
        cluster = create_uv_sphere(np.random.uniform(0.2, 0.4), 6, 8)
        cluster.apply_translation([
            np.random.uniform(-1.0, 1.0),
            np.random.uniform(-1.0, 1.0),
            np.random.uniform(2.5, 4.0)
        ])
        color_mesh(cluster, leaf_color)
        add_noise_to_mesh(cluster, 0.02)
        meshes.append(cluster)
    
    tree = combine_meshes(meshes)
    return tree


def generate_willow_tree():
    """Generate a weeping willow with drooping branches."""
    meshes = []
    
    # Thick trunk
    trunk = create_cylinder(0.2, 0.3, 3.0, 12)
    color_mesh(trunk, [90, 65, 30, 255])
    meshes.append(trunk)
    
    # Major branches going up and out
    for i in range(6):
        angle = (i / 6) * 2 * np.pi
        branch = create_cylinder(0.04, 0.08, 1.5, 8)
        tilt = trimesh.transformations.rotation_matrix(np.pi/4, [0,1,0])
        branch.apply_transform(tilt)
        rot = trimesh.transformations.rotation_matrix(angle, [0,0,1])
        branch.apply_transform(rot)
        branch.apply_translation([0, 0, 2.8])
        color_mesh(branch, [80, 60, 28, 255])
        meshes.append(branch)
    
    # Drooping foliage strands
    for i in range(30):
        angle = (i / 30) * 2 * np.pi
        radius = np.random.uniform(0.8, 1.5)
        start_z = np.random.uniform(2.5, 3.5)
        
        # Create a drooping strand as a thin cylinder chain
        num_segments = 5
        for j in range(num_segments):
            t = j / num_segments
            seg = create_cylinder(0.01, 0.015, 0.4, 4)
            
            x = radius * np.cos(angle) * (1 + t * 0.3)
            y = radius * np.sin(angle) * (1 + t * 0.3)
            z = start_z - t * 1.5
            
            seg.apply_translation([x, y, z])
            
            # droop tilt
            droop = trimesh.transformations.rotation_matrix(t * np.pi/3, [1,0,0])
            seg.apply_transform(droop)
            
            g = int(90 + np.random.uniform(-15, 15))
            color_mesh(seg, [50, g, 30, 255])
            meshes.append(seg)
    
    # Leaf clusters at branch tips
    for i in range(15):
        cluster = create_uv_sphere(np.random.uniform(0.15, 0.3), 6, 8)
        a = np.random.uniform(0, 2*np.pi)
        r = np.random.uniform(0.5, 1.2)
        cluster.apply_translation([
            r * np.cos(a), r * np.sin(a),
            np.random.uniform(1.5, 3.0)
        ])
        color_mesh(cluster, [55, 130, 35, 255])
        meshes.append(cluster)
    
    tree = combine_meshes(meshes)
    return tree


def generate_dead_tree():
    """Generate a bare/dead tree."""
    meshes = []
    
    # Main trunk - gnarled
    trunk = create_cylinder(0.1, 0.18, 3.0, 10)
    # Twist the trunk
    for i, v in enumerate(trunk.vertices):
        trunk.vertices[i][0] += 0.08 * np.sin(v[2] * 2)
        trunk.vertices[i][1] += 0.05 * np.cos(v[2] * 1.5)
    color_mesh(trunk, [70, 55, 35, 255])
    meshes.append(trunk)
    
    # Bare branches
    branch_configs = [
        (0.3, np.pi/3, 0, 1.5),
        (0.8, np.pi/4, np.pi/2, 1.2),
        (1.5, np.pi/3, np.pi, 1.0),
        (2.0, np.pi/4, np.pi*1.5, 0.8),
        (2.5, np.pi/5, np.pi/3, 0.6),
    ]
    
    for z, tilt_angle, rot_angle, length in branch_configs:
        branch = create_cylinder(0.02, 0.05, length, 6)
        tilt = trimesh.transformations.rotation_matrix(tilt_angle, [0,1,0])
        branch.apply_transform(tilt)
        rot = trimesh.transformations.rotation_matrix(rot_angle, [0,0,1])
        branch.apply_transform(rot)
        branch.apply_translation([0, 0, z])
        color_mesh(branch, [65, 50, 30, 255])
        meshes.append(branch)
        
        # Sub-branches
        for k in range(2):
            sub = create_cylinder(0.01, 0.02, length * 0.4, 4)
            sub_tilt = trimesh.transformations.rotation_matrix(np.pi/3, [0,1,0])
            sub.apply_transform(sub_tilt)
            sub_rot = trimesh.transformations.rotation_matrix(k * np.pi, [0,0,1])
            sub.apply_transform(sub_rot)
            sub.apply_translation([0, 0, z + length * 0.5])
            color_mesh(sub, [60, 45, 28, 255])
            meshes.append(sub)
    
    tree = combine_meshes(meshes)
    return tree


# ============================================================
# GRASS GENERATORS
# ============================================================

def generate_grass_patch(density="medium", size=1.0):
    """Generate a grass patch with individual blades."""
    meshes = []
    
    density_map = {"sparse": 20, "medium": 50, "dense": 100}
    num_blades = density_map.get(density, 50)
    
    colors = [
        [50, 140, 30, 255], [60, 155, 35, 255], [45, 130, 25, 255],
        [55, 145, 32, 255], [65, 160, 38, 255]
    ]
    
    for i in range(num_blades):
        # Each blade is a thin triangle
        x = np.random.uniform(-size/2, size/2)
        y = np.random.uniform(-size/2, size/2)
        height = np.random.uniform(0.08, 0.2)
        width = np.random.uniform(0.005, 0.015)
        
        # Blade vertices
        blade_verts = np.array([
            [x - width, y, 0],
            [x + width, y, 0],
            [x + np.random.uniform(-0.01, 0.01), y, height],
        ])
        
        # Slight bend
        blade_verts[2][0] += np.random.uniform(-0.02, 0.02)
        blade_verts[2][1] += np.random.uniform(-0.02, 0.02)
        
        blade = trimesh.Trimesh(
            vertices=blade_verts,
            faces=np.array([[0, 1, 2]])
        )
        
        color_mesh(blade, colors[i % len(colors)])
        meshes.append(blade)
    
    # Base plane
    base = trimesh.creation.box(extents=[size, size, 0.01])
    base.apply_translation([0, 0, -0.005])
    color_mesh(base, [40, 100, 25, 255])
    meshes.append(base)
    
    return combine_meshes(meshes)


def generate_tall_grass(size=1.0):
    """Generate tall wild grass."""
    meshes = []
    num_blades = 80
    
    for i in range(num_blades):
        x = np.random.uniform(-size/2, size/2)
        y = np.random.uniform(-size/2, size/2)
        height = np.random.uniform(0.2, 0.5)
        
        # Taller, thinner blades with more curve
        blade_verts = []
        segments = 5
        for j in range(segments + 1):
            t = j / segments
            blade_verts.append([
                x + 0.02 * np.sin(t * np.pi) * np.random.uniform(-1, 1),
                y + 0.02 * np.cos(t * np.pi) * np.random.uniform(-1, 1),
                t * height
            ])
        
        # Create blade faces
        blade_faces = []
        for j in range(segments):
            # Front face
            blade_faces.append([j, j+1, segments + 1 + j + 1])
            blade_faces.append([j, segments + 1 + j + 1, segments + 1 + j])
        
        # Add back vertices (offset slightly)
        for v in blade_verts.copy():
            blade_verts.append([v[0] + 0.003, v[1] + 0.003, v[2]])
        
        blade = trimesh.Trimesh(
            vertices=np.array(blade_verts),
            faces=np.array(blade_faces)
        )
        
        g = int(100 + np.random.uniform(-20, 20))
        color_mesh(blade, [40, g, 25, 255])
        meshes.append(blade)
    
    return combine_meshes(meshes)


def generate_grass_meadow(size=5.0, density=200):
    """Generate a large meadow with mixed grass."""
    meshes = []
    
    # Ground plane
    ground = trimesh.creation.box(extents=[size, size, 0.05])
    ground.apply_translation([0, 0, -0.025])
    color_mesh(ground, [45, 110, 28, 255])
    meshes.append(ground)
    
    # Mixed grass types
    for i in range(density):
        x = np.random.uniform(-size/2, size/2)
        y = np.random.uniform(-size/2, size/2)
        
        grass_type = np.random.choice(["short", "medium", "tall"])
        
        if grass_type == "short":
            height = np.random.uniform(0.03, 0.08)
            width = 0.008
        elif grass_type == "medium":
            height = np.random.uniform(0.08, 0.2)
            width = 0.01
        else:
            height = np.random.uniform(0.2, 0.4)
            width = 0.006
        
        blade_verts = np.array([
            [x - width, y, 0],
            [x + width, y, 0],
            [x + np.random.uniform(-0.03, 0.03), y + np.random.uniform(-0.02, 0.02), height],
        ])
        
        blade = trimesh.Trimesh(vertices=blade_verts, faces=np.array([[0, 1, 2]]))
        
        g = int(110 + np.random.uniform(-25, 25))
        color_mesh(blade, [45, g, 28, 255])
        meshes.append(blade)
    
    return combine_meshes(meshes)


# ============================================================
# TERRAIN GENERATORS
# ============================================================

def generate_flat_terrain(size=10.0, resolution=20):
    """Generate a flat terrain with slight undulation."""
    # Create a grid
    x = np.linspace(-size/2, size/2, resolution)
    y = np.linspace(-size/2, size/2, resolution)
    
    vertices = []
    for yi in y:
        for xi in x:
            # Slight height variation
            z = np.random.uniform(0, 0.05) + 0.02 * np.sin(xi * 0.5) * np.cos(yi * 0.5)
            vertices.append([xi, yi, z])
    
    vertices = np.array(vertices)
    
    faces = []
    for j in range(resolution - 1):
        for i in range(resolution - 1):
            idx = j * resolution + i
            faces.append([idx, idx + resolution, idx + 1])
            faces.append([idx + 1, idx + resolution, idx + resolution + 1])
    
    terrain = trimesh.Trimesh(vertices=vertices, faces=np.array(faces))
    terrain.fix_normals()
    
    # Green-brown coloring
    colors = []
    for v in vertices:
        r = int(60 + np.random.uniform(-10, 10))
        g = int(120 + np.random.uniform(-15, 15))
        b = int(35 + np.random.uniform(-5, 5))
        colors.append([r, g, b, 255])
    
    terrain.visual.vertex_colors = np.array(colors, dtype=np.uint8)
    return terrain


def generate_hilly_terrain(size=10.0, resolution=25, hill_height=1.5):
    """Generate terrain with rolling hills."""
    x = np.linspace(-size/2, size/2, resolution)
    y = np.linspace(-size/2, size/2, resolution)
    
    vertices = []
    for yi in y:
        for xi in x:
            # Multi-octave noise for natural hills
            z = 0
            z += hill_height * 0.5 * np.sin(xi * 0.3) * np.cos(yi * 0.3)
            z += hill_height * 0.25 * np.sin(xi * 0.7 + 1) * np.cos(yi * 0.5 + 2)
            z += hill_height * 0.125 * np.sin(xi * 1.3 + 3) * np.cos(yi * 1.1 + 1)
            z += np.random.uniform(0, 0.05)
            vertices.append([xi, yi, z])
    
    vertices = np.array(vertices)
    
    faces = []
    for j in range(resolution - 1):
        for i in range(resolution - 1):
            idx = j * resolution + i
            faces.append([idx, idx + resolution, idx + 1])
            faces.append([idx + 1, idx + resolution, idx + resolution + 1])
    
    terrain = trimesh.Trimesh(vertices=vertices, faces=np.array(faces))
    terrain.fix_normals()
    
    # Color based on height
    min_z = vertices[:, 2].min()
    max_z = vertices[:, 2].max()
    colors = []
    for v in vertices:
        t = (v[2] - min_z) / (max_z - min_z + 0.001)
        r = int(50 + t * 30 + np.random.uniform(-5, 5))
        g = int(130 - t * 40 + np.random.uniform(-10, 10))
        b = int(30 + t * 10 + np.random.uniform(-3, 3))
        colors.append([r, g, b, 255])
    
    terrain.visual.vertex_colors = np.array(colors, dtype=np.uint8)
    return terrain


def generate_rocky_terrain(size=10.0, resolution=20):
    """Generate rocky terrain with sharp features."""
    x = np.linspace(-size/2, size/2, resolution)
    y = np.linspace(-size/2, size/2, resolution)
    
    vertices = []
    for yi in y:
        for xi in x:
            z = 0.3 * np.sin(xi * 0.8) * np.cos(yi * 0.8)
            z += 0.5 * abs(np.sin(xi * 1.5 + yi * 0.7))
            z += np.random.uniform(-0.1, 0.1)
            vertices.append([xi, yi, max(0, z)])
    
    vertices = np.array(vertices)
    
    faces = []
    for j in range(resolution - 1):
        for i in range(resolution - 1):
            idx = j * resolution + i
            faces.append([idx, idx + resolution, idx + 1])
            faces.append([idx + 1, idx + resolution, idx + resolution + 1])
    
    terrain = trimesh.Trimesh(vertices=vertices, faces=np.array(faces))
    terrain.fix_normals()
    
    # Rocky coloring
    colors = []
    for v in vertices:
        gray = int(100 + np.random.uniform(-20, 20))
        r = gray + int(np.random.uniform(-5, 5))
        g = gray - 5 + int(np.random.uniform(-5, 5))
        b = gray - 10 + int(np.random.uniform(-5, 5))
        colors.append([r, g, b, 255])
    
    terrain.visual.vertex_colors = np.array(colors, dtype=np.uint8)
    return terrain


def generate_sandy_terrain(size=10.0, resolution=20):
    """Generate sandy/desert terrain."""
    x = np.linspace(-size/2, size/2, resolution)
    y = np.linspace(-size/2, size/2, resolution)
    
    vertices = []
    for yi in y:
        for xi in x:
            z = 0.1 * np.sin(xi * 0.4) * np.cos(yi * 0.3)
            z += 0.05 * np.sin(xi * 1.2 + yi * 0.8)
            vertices.append([xi, yi, z])
    
    vertices = np.array(vertices)
    
    faces = []
    for j in range(resolution - 1):
        for i in range(resolution - 1):
            idx = j * resolution + i
            faces.append([idx, idx + resolution, idx + 1])
            faces.append([idx + 1, idx + resolution, idx + resolution + 1])
    
    terrain = trimesh.Trimesh(vertices=vertices, faces=np.array(faces))
    terrain.fix_normals()
    
    # Sandy colors
    colors = []
    for v in vertices:
        r = int(194 + np.random.uniform(-10, 10))
        g = int(178 + np.random.uniform(-10, 10))
        b = int(128 + np.random.uniform(-10, 10))
        colors.append([r, g, b, 255])
    
    terrain.visual.vertex_colors = np.array(colors, dtype=np.uint8)
    return terrain


# ============================================================
# ROCK GENERATORS
# ============================================================

def generate_rock_small():
    """Generate a small rock/pebble."""
    rock = create_icosphere(subdivisions=2, radius=0.1)
    # Deform for natural look
    rock.vertices *= np.array([1.2, 0.8, 0.7])
    rock.vertices += np.random.normal(0, 0.01, rock.vertices.shape)
    rock.fix_normals()
    color_mesh(rock, [130, 125, 115, 255])
    return rock


def generate_rock_medium():
    """Generate a medium rock."""
    rock = create_icosphere(subdivisions=2, radius=0.25)
    rock.vertices *= np.array([1.3, 0.9, 0.8])
    rock.vertices += np.random.normal(0, 0.02, rock.vertices.shape)
    rock.fix_normals()
    
    colors = []
    for v in rock.vertices:
        gray = 110 + int(v[2] * 30) + int(np.random.uniform(-10, 10))
        colors.append([gray, gray - 5, gray - 10, 255])
    rock.visual.vertex_colors = np.array(colors, dtype=np.uint8)
    return rock


def generate_boulder():
    """Generate a large boulder."""
    boulder = create_icosphere(subdivisions=3, radius=0.5)
    boulder.vertices *= np.array([1.4, 1.1, 0.9])
    boulder.vertices += np.random.normal(0, 0.03, boulder.vertices.shape)
    boulder.fix_normals()
    
    colors = []
    for v in boulder.vertices:
        gray = 100 + int(v[2] * 20) + int(np.random.uniform(-15, 15))
        colors.append([gray, gray - 8, gray - 15, 255])
    boulder.visual.vertex_colors = np.array(colors, dtype=np.uint8)
    return boulder


def generate_rock_cluster():
    """Generate a cluster of rocks."""
    meshes = []
    
    positions = [
        [0, 0, 0, 0.3],
        [0.3, 0.2, 0, 0.2],
        [-0.2, 0.3, 0, 0.15],
        [0.1, -0.25, 0, 0.18],
        [-0.3, -0.1, 0, 0.12],
    ]
    
    for x, y, z, r in positions:
        rock = create_icosphere(subdivisions=2, radius=r)
        rock.vertices *= np.array([
            np.random.uniform(1.0, 1.4),
            np.random.uniform(0.8, 1.2),
            np.random.uniform(0.7, 1.0)
        ])
        rock.vertices += np.random.normal(0, 0.01, rock.vertices.shape)
        rock.fix_normals()
        rock.apply_translation([x, y, z])
        
        gray = int(110 + np.random.uniform(-15, 15))
        color_mesh(rock, [gray, gray - 5, gray - 10, 255])
        meshes.append(rock)
    
    return combine_meshes(meshes)


# ============================================================
# VEGETATION GENERATORS
# ============================================================

def generate_bush():
    """Generate a leafy bush."""
    meshes = []
    
    # Multiple overlapping spheres for bush shape
    num_clusters = 8
    for i in range(num_clusters):
        r = np.random.uniform(0.2, 0.4)
        cluster = create_icosphere(subdivisions=2, radius=r)
        
        offset = np.array([
            np.random.uniform(-0.3, 0.3),
            np.random.uniform(-0.3, 0.3),
            np.random.uniform(0.1, 0.4)
        ])
        cluster.apply_translation(offset)
        
        g = int(90 + np.random.uniform(-20, 20))
        color_mesh(cluster, [30, g, 25, 255])
        add_noise_to_mesh(cluster, 0.02)
        meshes.append(cluster)
    
    # Small trunk
    trunk = create_cylinder(0.03, 0.05, 0.3, 6)
    trunk.apply_translation([0, 0, 0.15])
    color_mesh(trunk, [80, 55, 25, 255])
    meshes.append(trunk)
    
    return combine_meshes(meshes)


def generate_flowers(num_flowers=20, size=1.0):
    """Generate a patch of colorful flowers."""
    meshes = []
    
    flower_colors = [
        [220, 50, 50, 255],   # Red
        [220, 180, 50, 255],  # Yellow
        [180, 50, 220, 255],  # Purple
        [220, 120, 50, 255],  # Orange
        [220, 50, 180, 255],  # Pink
        [255, 255, 255, 255], # White
    ]
    
    for i in range(num_flowers):
        x = np.random.uniform(-size/2, size/2)
        y = np.random.uniform(-size/2, size/2)
        
        # Stem
        stem = create_cylinder(0.005, 0.005, 0.15, 4)
        stem.apply_translation([x, y, 0.075])
        color_mesh(stem, [40, 100, 25, 255])
        meshes.append(stem)
        
        # Flower head (small sphere)
        head = create_uv_sphere(0.025, 6, 8)
        head.apply_translation([x, y, 0.17])
        color_mesh(head, flower_colors[i % len(flower_colors)])
        meshes.append(head)
        
        # Petals (small spheres around center)
        for p in range(5):
            angle = (p / 5) * 2 * np.pi
            petal = create_uv_sphere(0.015, 4, 6)
            petal.apply_translation([
                x + 0.03 * np.cos(angle),
                y + 0.03 * np.sin(angle),
                0.17
            ])
            color_mesh(petal, flower_colors[(i + 1) % len(flower_colors)])
            meshes.append(petal)
    
    return combine_meshes(meshes)


def generate_tree_stump():
    """Generate a tree stump."""
    meshes = []
    
    # Main stump
    stump = create_cylinder(0.25, 0.3, 0.5, 12)
    color_mesh(stump, [90, 60, 30, 255])
    meshes.append(stump)
    
    # Top ring
    top = create_cylinder(0.25, 0.25, 0.02, 12)
    top.apply_translation([0, 0, 0.5])
    color_mesh(top, [140, 100, 50, 255])
    meshes.append(top)
    
    # Bark texture rings
    for i in range(3):
        ring = create_cylinder(0.31, 0.31, 0.03, 12)
        ring.apply_translation([0, 0, 0.1 + i * 0.15])
        color_mesh(ring, [70, 45, 20, 255])
        meshes.append(ring)
    
    # Roots
    for i in range(4):
        angle = (i / 4) * 2 * np.pi
        root = create_cylinder(0.04, 0.08, 0.4, 6)
        tilt = trimesh.transformations.rotation_matrix(np.pi/3, [0,1,0])
        root.apply_transform(tilt)
        rot = trimesh.transformations.rotation_matrix(angle, [0,0,1])
        root.apply_transform(rot)
        root.apply_translation([0, 0, 0.05])
        color_mesh(root, [80, 50, 22, 255])
        meshes.append(root)
    
    return combine_meshes(meshes)


def generate_log():
    """Generate a fallen log."""
    meshes = []
    
    # Main log
    log = create_cylinder(0.12, 0.15, 1.5, 10)
    # Rotate to lie on ground
    rot = trimesh.transformations.rotation_matrix(np.pi/2, [0,1,0])
    log.apply_transform(rot)
    color_mesh(log, [95, 65, 30, 255])
    meshes.append(log)
    
    # Cut ends
    for side in [-1, 1]:
        end = create_cylinder(0.13, 0.13, 0.02, 10)
        rot = trimesh.transformations.rotation_matrix(np.pi/2, [0,1,0])
        end.apply_transform(rot)
        end.apply_translation([side * 0.75, 0, 0])
        color_mesh(end, [140, 100, 50, 255])
        meshes.append(end)
    
    # Bark texture
    for i in range(8):
        ring = create_cylinder(0.155, 0.155, 0.02, 10)
        rot = trimesh.transformations.rotation_matrix(np.pi/2, [0,1,0])
        ring.apply_transform(rot)
        ring.apply_translation([-0.6 + i * 0.17, 0, 0])
        color_mesh(ring, [75, 50, 22, 255])
        meshes.append(ring)
    
    # Small branch stubs
    for i in range(3):
        stub = create_cylinder(0.015, 0.02, 0.15, 4)
        stub.apply_translation([-0.3 + i * 0.3, 0, 0.13])
        color_mesh(stub, [85, 55, 25, 255])
        meshes.append(stub)
    
    return combine_meshes(meshes)


def generate_mushroom():
    """Generate a mushroom."""
    meshes = []
    
    # Stem
    stem = create_cylinder(0.02, 0.03, 0.08, 8)
    stem.apply_translation([0, 0, 0.04])
    color_mesh(stem, [220, 210, 190, 255])
    meshes.append(stem)
    
    # Cap
    cap = create_uv_sphere(0.05, 8, 12)
    cap.vertices *= np.array([1, 1, 0.5])
    cap.apply_translation([0, 0, 0.09])
    color_mesh(cap, [180, 40, 30, 255])
    meshes.append(cap)
    
    # Spots on cap
    for i in range(5):
        spot = create_uv_sphere(0.008, 4, 6)
        angle = (i / 5) * 2 * np.pi
        spot.apply_translation([
            0.03 * np.cos(angle),
            0.03 * np.sin(angle),
            0.11
        ])
        color_mesh(spot, [240, 235, 220, 255])
        meshes.append(spot)
    
    return combine_meshes(meshes)


# ============================================================
# GROUND / MATERIALS
# ============================================================

def generate_dirt_ground(size=5.0):
    """Generate a dirt ground patch."""
    ground = trimesh.creation.box(extents=[size, size, 0.1])
    
    colors = []
    for v in ground.vertices:
        r = int(110 + np.random.uniform(-15, 15))
        g = int(80 + np.random.uniform(-10, 10))
        b = int(50 + np.random.uniform(-8, 8))
        colors.append([r, g, b, 255])
    ground.visual.vertex_colors = np.array(colors, dtype=np.uint8)
    return ground


def generate_stone_path(size=5.0):
    """Generate a stone path surface."""
    meshes = []
    
    # Base
    base = trimesh.creation.box(extents=[size, size, 0.05])
    base.apply_translation([0, 0, -0.025])
    color_mesh(base, [90, 85, 75, 255])
    meshes.append(base)
    
    # Individual stones
    for i in range(15):
        stone = create_icosphere(subdivisions=1, radius=np.random.uniform(0.15, 0.3))
        stone.vertices *= np.array([
            np.random.uniform(1.0, 1.5),
            np.random.uniform(1.0, 1.5),
            0.3
        ])
        stone.fix_normals()
        stone.apply_translation([
            np.random.uniform(-size/2 + 0.3, size/2 - 0.3),
            np.random.uniform(-size/2 + 0.3, size/2 - 0.3),
            0.02
        ])
        gray = int(120 + np.random.uniform(-20, 20))
        color_mesh(stone, [gray, gray - 5, gray - 10, 255])
        meshes.append(stone)
    
    return combine_meshes(meshes)


# ============================================================
# MAIN GENERATION
# ============================================================

def main():
    base_dir = Path(__file__).parent
    
    models = {
        "trees": {
            "oak_tree": generate_oak_tree,
            "pine_tree": generate_pine_tree,
            "palm_tree": generate_palm_tree,
            "birch_tree": generate_birch_tree,
            "willow_tree": generate_willow_tree,
            "dead_tree": generate_dead_tree,
        },
        "grass": {
            "grass_sparse": lambda: generate_grass_patch("sparse"),
            "grass_medium": lambda: generate_grass_patch("medium"),
            "grass_dense": lambda: generate_grass_patch("dense"),
            "tall_grass": generate_tall_grass,
            "grass_meadow": generate_grass_meadow,
        },
        "terrain": {
            "flat_terrain": generate_flat_terrain,
            "hilly_terrain": generate_hilly_terrain,
            "rocky_terrain": generate_rocky_terrain,
            "sandy_terrain": generate_sandy_terrain,
        },
        "rocks": {
            "rock_small": generate_rock_small,
            "rock_medium": generate_rock_medium,
            "boulder": generate_boulder,
            "rock_cluster": generate_rock_cluster,
        },
        "vegetation": {
            "bush": generate_bush,
            "flowers": generate_flowers,
            "tree_stump": generate_tree_stump,
            "log": generate_log,
            "mushroom": generate_mushroom,
        },
        "ground": {
            "dirt_ground": generate_dirt_ground,
            "stone_path": generate_stone_path,
        }
    }
    
    manifest = {"models": {}, "total_polygons": 0}
    
    for category, category_models in models.items():
        cat_dir = base_dir / category if category != "ground" else base_dir / "terrain"
        cat_dir.mkdir(parents=True, exist_ok=True)
        
        for name, generator in category_models.items():
            print(f"Generating {name}...", end=" ")
            try:
                mesh = generator()
                filepath = cat_dir / f"{name}.glb"
                mesh.export(str(filepath))
                
                tris = len(mesh.faces)
                verts = len(mesh.vertices)
                manifest["models"][name] = {
                    "path": str(filepath.relative_to(base_dir.parent)),
                    "category": category,
                    "vertices": verts,
                    "triangles": tris,
                }
                manifest["total_polygons"] += tris
                print(f"OK ({verts} verts, {tris} tris)")
            except Exception as e:
                print(f"ERROR: {e}")
    
    # Save manifest
    manifest_path = base_dir / "ASSET_MANIFEST.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    
    print(f"\n{'='*60}")
    print(f"GENERATION COMPLETE!")
    print(f"Total models: {len(manifest['models'])}")
    print(f"Total polygons: {manifest['total_polygons']:,}")
    print(f"Manifest: {manifest_path}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
