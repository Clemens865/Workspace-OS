// Flat config. The type checker owns types and unused symbols (see tsconfig);
// lint covers what it cannot: likely mistakes and the rules of hooks.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-undef': 'off', // TypeScript reports undefined names, with type awareness
      'no-control-regex': 'off', // the path and header validators match control characters on purpose
      'no-irregular-whitespace': ['error', { skipRegExps: true }], // CSV readers strip a BOM
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true, allowShortCircuit: true }],
      '@typescript-eslint/no-unused-vars': 'off', // noUnusedLocals / noUnusedParameters
    },
  },
)
