/* Vanilla JS Particles Background 
 * Recreates the ReactBits Particles component behavior.
 */

class Particles {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    
    this.options = Object.assign({
      particleColor: 'rgba(255, 255, 255, 0.8)',
      lineColor: 'rgba(255, 255, 255, 0.3)',
      particleAmount: 100,
      defaultRadius: 1.5,
      variantRadius: 2,
      defaultSpeed: 0.5,
      variantSpeed: 1,
      linkRadius: 120,
      interactive: true,
    }, options);

    this.particles = [];
    this.mouse = { x: null, y: null };
    this.animationFrame = null;

    this.init();
  }

  init() {
    this.resize();
    window.addEventListener('resize', () => this.resize());
    
    if (this.options.interactive) {
      this.canvas.addEventListener('mousemove', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = e.clientX - rect.left;
        this.mouse.y = e.clientY - rect.top;
      });
      this.canvas.addEventListener('mouseleave', () => {
        this.mouse.x = null;
        this.mouse.y = null;
      });
    }

    this.createParticles();
    this.animate();
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  createParticles() {
    this.particles = [];
    for (let i = 0; i < this.options.particleAmount; i++) {
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        vx: (Math.random() - 0.5) * this.options.variantSpeed + (Math.random() > 0.5 ? this.options.defaultSpeed : -this.options.defaultSpeed),
        vy: (Math.random() - 0.5) * this.options.variantSpeed + (Math.random() > 0.5 ? this.options.defaultSpeed : -this.options.defaultSpeed),
        r: this.options.defaultRadius + Math.random() * this.options.variantRadius,
      });
    }
  }

  draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0 || p.x > this.canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > this.canvas.height) p.vy *= -1;

      // Interaction with mouse (push particles slightly)
      if (this.options.interactive && this.mouse.x !== null) {
        let dx = this.mouse.x - p.x;
        let dy = this.mouse.y - p.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 100) {
          p.x -= dx * 0.05;
          p.y -= dy * 0.05;
        }
      }

      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      this.ctx.fillStyle = this.options.particleColor;
      this.ctx.fill();

      for (let j = i + 1; j < this.particles.length; j++) {
        const p2 = this.particles[j];
        let dx = p.x - p2.x;
        let dy = p.y - p2.y;
        let dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < this.options.linkRadius) {
          this.ctx.beginPath();
          this.ctx.moveTo(p.x, p.y);
          this.ctx.lineTo(p2.x, p2.y);
          let opacity = 1 - (dist / this.options.linkRadius);
          this.ctx.strokeStyle = this.options.lineColor.replace(/[\d\.]+\)$/g, `${opacity * 0.5})`);
          this.ctx.stroke();
        }
      }
    }
  }

  animate() {
    this.draw();
    this.animationFrame = requestAnimationFrame(() => this.animate());
  }
}

// Initialize when ready
document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("particles-canvas")) {
    new Particles("particles-canvas", {
      particleColor: "rgba(255, 255, 255, 0.8)",
      lineColor: "rgba(255, 255, 255, 0.5)",
      particleAmount: Math.min(100, (window.innerWidth * window.innerHeight) / 10000), // Responsive count
      interactive: true
    });
  }
});
