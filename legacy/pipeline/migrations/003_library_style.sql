-- The studio's library of looks, seeded so a fresh database (Neon) has one.
--
-- Only one look has been measured on the locked model: the Phase 1 dark oil
-- painting (PLAN.md 8.11, 9.x). It is offered as the default, and its prompt
-- prefix is editable per film in the look stage (DESIGN.md "Stage: style").
-- Untested presets are deliberately not seeded: the candidates would reveal a
-- bad one, but only after spending the GPU on it.
--
-- hero_full / hero_crop point at the Phase 1 references so the library style
-- stays renderable on its own (`jobs seed`); a film's own look replaces them
-- with its chosen frame and crop.
INSERT INTO styles (id, name, preset_json, is_library) VALUES (
    'sty_dark_oil',
    'Dark oil painting',
    '{"preset": "dark-oil-painting",
      "prompt_prefix": "dark oil painting, heavy impasto, chiaroscuro, muted earth palette, cinematic documentary still,",
      "seed": 88412,
      "hero_full": "bench/refs/hero.png",
      "hero_crop": "bench/refs/hero_crop.png",
      "crop_box": [0.22, 0.0, 0.70, 1.0]}',
    true
) ON CONFLICT (id) DO NOTHING;
