/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,ts}"],
  theme: {
    extend: {
      colors: {
        ink: "#112031",
        mist: "#edf2f5",
        sea: "#0f766e",
        sun: "#f59e0b",
        rust: "#c2410c",
        slateblue: "#355c7d"
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"]
      },
      boxShadow: {
        panel: "0 18px 50px rgba(17, 32, 49, 0.08)"
      }
    }
  },
  plugins: []
};
