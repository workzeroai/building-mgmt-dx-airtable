import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'coverage/', 'out/', 'data/store/'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'object-shorthand': 'error',
      'no-console': 'off',
    },
  },
  {
    files: ['quote-engine/src/public/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // 에어테이블 자동화 스크립트: 에어테이블이 주는 전역(base·input·output) + 최상위 await
    files: ['airtable/automations/scripts/**/*.js'],
    languageOptions: { globals: { base: 'readonly', input: 'readonly', output: 'readonly' } },
  },
  {
    // n8n Code 노드: 최상위 return, n8n이 주는 전역($input·$·items)
    files: ['n8n/code/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { $input: 'readonly', $: 'readonly', items: 'readonly' } },
    // 공용 판정 코드(lib/sync-core.js)를 통째로 넣어서 노드마다 쓰지 않는 함수가 생긴다
    rules: { 'no-unused-vars': 'off' },
  },
];
