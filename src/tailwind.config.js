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
        // Default UI sans
        sans: ["Inter", "system-ui", "sans-serif"],

        // === Script / Emotional ===
        greatvibes: ["'Great Vibes'", "cursive"],
        tangerine: ["'Tangerine'", "cursive"],
        hurricane: ["'Hurricane'", "cursive"],
        pacifico: ["'Pacifico'", "cursive"],

        // === Luxury Serif ===
        playfair: ["'Playfair Display'", "serif"],
        abril: ["'Abril Fatface'", "serif"],
        cinzel: ["'Cinzel'", "serif"],
        cinzelDecorative: ["'Cinzel Decorative'", "serif"],
        marcellus: ["'Marcellus'", "serif"],
        cormorant: ["'Cormorant Garamond'", "serif"],
        prata: ["'Prata'", "serif"],
        cardo: ["'Cardo'", "serif"],
        baskerville: ["'Libre Baskerville'", "serif"],
        zillaslab: ["'Zilla Slab'", "serif"],

        // === Clean Modern Sans ===
        montserrat: ["'Montserrat'", "sans-serif"],
        opensans: ["'Open Sans'", "sans-serif"],
        lato: ["'Lato'", "sans-serif"],
        oswald: ["'Oswald'", "sans-serif"],
        poppins: ["'Poppins'", "sans-serif"],
        raleway: ["'Raleway'", "sans-serif"],
        nunito: ["'Nunito'", "sans-serif"],
        comfortaa: ["'Comfortaa'", "sans-serif"],
        zalando: ["'Zalando Sans'", "sans-serif"],
        julius: ["'Julius Sans One'", "sans-serif"],
        unica: ["'Unica One'", "sans-serif"],
        sawarabi: ["'Sawarabi Gothic'", "sans-serif"],

        // === Bold / Display / Athletic / Hype ===
        impact: ["Impact", "'Arial Black'", "sans-serif"],
        bebasneue: ["'Bebas Neue'", "sans-serif"],
        bebasneueExpanded: ["'Bebas Neue Expanded'", "sans-serif"],
        anton: ["'Anton'", "sans-serif"],
        leaguegothic: ["'League Gothic'", "sans-serif"],
        staatliches: ["'Staatliches'", "sans-serif"],
        bungee: ["'Bungee'", "sans-serif"],
        bungeeshade: ["'Bungee Shade'", "sans-serif"],
        blackops: ["'Black Ops One'", "sans-serif"],
        stint: ["'Stint Ultra Expanded'", "sans-serif"],
        teko: ["'Teko'", "sans-serif"],
        righteous: ["'Righteous'", "sans-serif"],
        kanit: ["'Kanit'", "sans-serif"],
        oxanium: ["'Oxanium'", "sans-serif"],
        archivo: ["'Archivo Black'", "sans-serif"],
        fredoka: ["'Fredoka One'", "sans-serif"]
      }
    },
  },
  plugins: [],
}
