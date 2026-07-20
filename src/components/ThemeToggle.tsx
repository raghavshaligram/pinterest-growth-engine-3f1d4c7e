import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "pinspider-theme";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
    const initial = saved ?? "light";
    setTheme(initial);
    applyTheme(initial);
  }, []);

  function applyTheme(next: Theme) {
    const root = document.documentElement;
    if (next === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  if (!mounted) {
    return (
      <Button variant="ghost" size="sm" className="w-full justify-start gap-2" disabled>
        <Sun className="h-4 w-4" /> Theme
      </Button>
    );
  }

  return (
    <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={toggle}>
      {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      {theme === "dark" ? "Dark mode" : "Light mode"}
    </Button>
  );
}
