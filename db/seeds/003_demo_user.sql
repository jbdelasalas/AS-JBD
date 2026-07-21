-- 003_demo_user.sql
-- Seed an initial superadmin user.
--
-- Email:    admin@afcc.ph
-- Password: artfresh2026
--
-- The password_hash below is a bcrypt hash with cost 10.
--
-- To regenerate:
--   node -e "console.log(require('bcryptjs').hashSync('Improtected@01', 10))"

INSERT INTO users (id, email, password_hash, full_name, is_active, is_superadmin)
VALUES (
  '99999999-9999-9999-9999-999999999999',
  'admin@afcc.ph',
  '$2a$10$hzStWyBukuNQF40GvUzt7uOAZ1u3cfRoL84QhGSSnRTCYYL34hc3W',  -- Improtected@01
  'System Administrator',
  true,
  true
) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash;

-- Assign superadmin role for the demo company
INSERT INTO user_roles (user_id, role_id, company_id)
SELECT '99999999-9999-9999-9999-999999999999', r.id, '11111111-1111-1111-1111-111111111111'
FROM roles r WHERE r.code = 'superadmin'
ON CONFLICT DO NOTHING;
