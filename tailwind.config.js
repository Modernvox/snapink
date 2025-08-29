/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./*.html",
    "./**/*.html",
    "./js/**/*.js"
  ],
  theme: {
    extend: {
      colors: {
        brand: "#ec4899",   // SnapInk pink highlight
        ink: "#0a0a0a",     // deep neutral bg
        dark: "#111111",    // strap dark gray
        muted: "#9aa7b8"    // subtle neutral
      },
      boxShadow: {
        card: "0 10px 30px rgba(0,0,0,.35)", // used on hover cards
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"]
      }
    },
  },
  plugins: [],
}
