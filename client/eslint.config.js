import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // shadcn/ui and Aceternity registry files are vendored verbatim. They ship
    // unused React imports alongside the automatic JSX runtime, colocate cva
    // variant objects with their components, and use the standard matchMedia
    // subscription pattern. Re-linting them would mean maintaining forks.
    files: [
      'src/components/ui/**',
      'src/Components/ui/**',
      'src/hooks/**',
      'src/Hooks/**',
    ],
    rules: {
      'no-unused-vars': 'off',
      'react-refresh/only-export-components': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // Exporting a context's hook alongside its provider is the intended shape.
    files: [
      'src/context/AuthContext.jsx',
      'src/Context/AuthContext.jsx',
      'src/Context/ResumeContext.jsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
