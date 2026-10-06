import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'node_modules/**', 'build/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the secure random helpers.' },
      ],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['node:*', '**/main/**', 'electron'] },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', 'scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
);
