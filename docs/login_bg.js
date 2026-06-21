/* login_bg.js - Threads-style network animation for Login Page */

class NetworkAnimation {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    
    this.particles = [];
    this.numParticles = 80;
    this.maxDistance = 150;
    this.mouse = { x: null, y: null };
    
    this.init();
  }

  init() {
    this.resize();
    window.addEventListener('resize', () => this.resize());
    
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
    });
    this.canvas.addEventListener('mouseleave', () => {
      this.mouse.x = null;
      this.mouse.y = null;
    });

    this.createParticles();
    this.animate();
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.numParticles = Math.min(100, (window.innerWidth * window.innerHeight) / 12000);
    this.createParticles();
  }

  createParticles() {
    this.particles = [];
    for (let i = 0; i < this.numParticles; i++) {
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        vx: (Math.random() - 0.5) * 0.8,
        vy: (Math.random() - 0.5) * 0.8,
        radius: Math.random() * 1.5 + 0.5
      });
    }
  }

  draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Draw particles
    this.ctx.fillStyle = 'rgba(45, 212, 191, 0.6)';
    
    for (let i = 0; i < this.particles.length; i++) {
      let p = this.particles[i];
      
      p.x += p.vx;
      p.y += p.vy;
      
      // Bounce off edges
      if (p.x < 0 || p.x > this.canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > this.canvas.height) p.vy *= -1;

      // Mouse interaction (pull slightly towards mouse)
      if (this.mouse.x !== null) {
        let dx = this.mouse.x - p.x;
        let dy = this.mouse.y - p.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 200) {
          p.x += dx * 0.005;
          p.y += dy * 0.005;
        }
      }

      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      this.ctx.fill();

      // Connect lines
      for (let j = i + 1; j < this.particles.length; j++) {
        let p2 = this.particles[j];
        let dx = p.x - p2.x;
        let dy = p.y - p2.y;
        let dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < this.maxDistance) {
          this.ctx.beginPath();
          this.ctx.moveTo(p.x, p.y);
          this.ctx.lineTo(p2.x, p2.y);
          let opacity = 1 - (dist / this.maxDistance);
          this.ctx.strokeStyle = `rgba(45, 212, 191, ${opacity * 0.4})`;
          this.ctx.stroke();
        }
      }
    }
  }

  animate() {
    this.draw();
    requestAnimationFrame(() => this.animate());
  }
}

// Start animation only when #login-mode is visible or just run in background
let loginAnim = null;
function startLoginAnimation() {
  if (!loginAnim && document.getElementById('login-network-canvas')) {
    loginAnim = new NetworkAnimation('login-network-canvas');
  }
}
