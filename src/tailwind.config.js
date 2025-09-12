/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./*.html",
    "./src/**/*.{js,jsx,ts,tsx,html}" 
  ],
  theme: {
    extend: {
      colors: {
        brand: "#ec4899",
        ink: "#0a0a0a",
        dark: "#111111",
        muted: "#9aa7b8"
      },
      boxShadow: {
        card: "0 10px 30px rgba(0,0,0,.35)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"]
      }
    },
  },
  plugins: [],
}
