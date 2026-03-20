// Premium FloridaBrew Landing Page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Initialize all interactive features
    initCountdown();
    initCTAButtons();
    initScrollAnimations();
    initTypingEffect();
    initTestimonialRotation();
    initPriceCalculator();
    
    console.log('☕ FloridaBrew Premium Landing Page Loaded!');
});

// Urgency countdown for spots remaining
function initCountdown() {
    const countdownElements = document.querySelectorAll('#countdown, #remaining-spots');
    let spotsLeft = 47;
    
    setInterval(() => {
        if (spotsLeft > 15) {
            spotsLeft -= Math.floor(Math.random() * 3) + 1;
            countdownElements.forEach(el => {
                if (el) el.textContent = spotsLeft + ' spots left';
            });
        }
    }, 15000); // Update every 15 seconds
}

// Enhanced CTA button interactions
function initCTAButtons() {
    const ctaButtons = document.querySelectorAll('.cta-btn');
    
    ctaButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Add click animation
            this.style.transform = 'scale(0.95)';
            setTimeout(() => {
                this.style.transform = '';
            }, 150);
            
            // Track plan selection
            const plan = this.dataset.plan || 'unknown';
            trackConversion(plan);
            
            // Scroll to pricing if not already there
            if (!this.closest('.pricing')) {
                document.getElementById('pricing').scrollIntoView({
                    behavior: 'smooth'
                });
            } else {
                // Show sign-up modal
                showSignupModal(plan);
            }
        });
        
        // Add hover effects
        button.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-2px) scale(1.02)';
        });
        
        button.addEventListener('mouseleave', function() {
            this.style.transform = '';
        });
    });
}

// Scroll-triggered animations
function initScrollAnimations() {
    const observerOptions = {
        threshold: 0.2,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');
                
                // Special animations for specific elements
                if (entry.target.classList.contains('feature')) {
                    animateFeature(entry.target);
                } else if (entry.target.classList.contains('step')) {
                    animateStep(entry.target);
                }
            }
        });
    }, observerOptions);
    
    // Observe all animatable elements
    document.querySelectorAll('.feature, .testimonial, .step, .plan').forEach(el => {
        observer.observe(el);
    });
}

// Typing effect for hero subtitle
function initTypingEffect() {
    const subtitle = document.querySelector('.hero-subtitle');
    if (!subtitle) return;
    
    const originalText = subtitle.textContent;
    const typingText = "The only coffee subscription engineered for Florida's heat and humidity. Our climate-adapted blends deliver 15% stronger flavors that won't fade when it's hot outside.";
    
    subtitle.textContent = '';
    let i = 0;
    
    function typeChar() {
        if (i < typingText.length) {
            subtitle.textContent += typingText.charAt(i);
            i++;
            setTimeout(typeChar, 30);
        }
    }
    
    // Start typing after a delay
    setTimeout(typeChar, 1000);
}

// Rotating testimonials for freshness
function initTestimonialRotation() {
    const testimonials = [
        {
            rating: "⭐⭐⭐⭐⭐",
            text: "I've tried every coffee subscription - Trade, Blue Bottle, Atlas. None of them understood Florida heat. FloridaBrew's climate-adapted blends actually taste BETTER in our humidity. Game changer!",
            author: "Maria Rodriguez",
            location: "Miami Beach • VIP Member"
        },
        {
            rating: "⭐⭐⭐⭐⭐", 
            text: "The cold brew filters alone are worth it. My morning iced coffee is now better than Starbucks and I'm saving $150/month. Plus, supporting local Florida roasters feels amazing.",
            author: "Jake Thompson", 
            location: "Tampa • Connoisseur Plan"
        },
        {
            rating: "⭐⭐⭐⭐⭐",
            text: "Finally found a subscription that gets Florida life. The weather-smart delivery means I never get stale beans, and the eco packaging is perfect for our coastline.",
            author: "Sarah Kim",
            location: "Fort Lauderdale • Starter Plan"
        },
        {
            rating: "⭐⭐⭐⭐⭐",
            text: "Living in the Keys, I need coffee that can handle 90°F and 90% humidity. FloridaBrew's special roasting actually makes the flavors POP in this climate. Incredible!",
            author: "Carlos Mendez",
            location: "Key West • Connoisseur Plan"
        },
        {
            rating: "⭐⭐⭐⭐⭐",
            text: "As a coffee shop owner, I know good beans. FloridaBrew's local roaster network brings me flavors I can't get anywhere else. My customers always ask what I'm drinking!",
            author: "Elena Rodriguez",
            location: "Orlando • VIP Member"
        }
    ];
    
    let currentTestimonials = testimonials.slice(0, 3);
    let rotation = 0;
    
    setInterval(() => {
        const testimonialElements = document.querySelectorAll('.testimonial');
        if (testimonialElements.length === 0) return;
        
        // Rotate testimonials
        rotation = (rotation + 1) % testimonials.length;
        const newTestimonial = testimonials[rotation];
        
        // Update the first testimonial
        const firstTestimonial = testimonialElements[0];
        updateTestimonial(firstTestimonial, newTestimonial);
        
    }, 8000); // Rotate every 8 seconds
}

// Price calculator for different frequencies
function initPriceCalculator() {
    const plans = document.querySelectorAll('.plan');
    
    plans.forEach(plan => {
        const priceElement = plan.querySelector('.price');
        if (!priceElement) return;
        
        const basePrice = parseInt(priceElement.textContent.replace('$', ''));
        
        // Add frequency selector
        const frequencySelector = createFrequencySelector(basePrice);
        plan.querySelector('.plan-content').insertBefore(
            frequencySelector, 
            plan.querySelector('.plan-features')
        );
    });
}

// Helper Functions

function animateFeature(feature) {
    const icon = feature.querySelector('.feature-icon');
    if (icon) {
        icon.style.animation = 'bounce 1s ease-in-out';
    }
}

function animateStep(step) {
    const number = step.querySelector('.step-number');
    if (number) {
        number.style.animation = 'pulse 1s ease-in-out';
    }
}

function updateTestimonial(element, data) {
    const rating = element.querySelector('.testimonial-rating');
    const text = element.querySelector('p');
    const name = element.querySelector('.author-name');
    const location = element.querySelector('.author-location');
    
    if (rating) rating.textContent = data.rating;
    if (text) text.textContent = data.text;
    if (name) name.textContent = data.author;
    if (location) location.textContent = data.location;
    
    // Add fade animation
    element.style.opacity = '0.5';
    setTimeout(() => {
        element.style.opacity = '1';
    }, 300);
}

function createFrequencySelector(basePrice) {
    const selector = document.createElement('div');
    selector.className = 'frequency-selector';
    selector.innerHTML = `
        <label>Delivery Frequency:</label>
        <select onchange="updatePrice(this, ${basePrice})">
            <option value="1">Every month ($${basePrice})</option>
            <option value="2">Every 2 weeks ($${Math.floor(basePrice * 1.7)})</option>
            <option value="0.5">Every 2 months ($${Math.floor(basePrice * 0.6)})</option>
        </select>
    `;
    return selector;
}

function updatePrice(selector, basePrice) {
    const frequency = parseFloat(selector.value);
    const newPrice = frequency === 1 ? basePrice : 
                    frequency === 2 ? Math.floor(basePrice * 1.7) : 
                    Math.floor(basePrice * 0.6);
    
    const priceElement = selector.closest('.plan').querySelector('.price');
    priceElement.textContent = `$${newPrice}`;
}

function showSignupModal(plan) {
    const modal = document.createElement('div');
    modal.className = 'signup-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>☕ Start Your FloridaBrew Journey</h3>
                <button class="close-modal" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                <p>You've selected the <strong>${plan || 'Premium'}</strong> plan!</p>
                <form class="signup-form">
                    <input type="email" placeholder="Your email address" required>
                    <input type="text" placeholder="Your name" required>
                    <input type="text" placeholder="Florida ZIP code" required>
                    <div class="coffee-preferences">
                        <label>Coffee Preferences:</label>
                        <label><input type="checkbox" value="cold-brew"> Cold Brew Focus</label>
                        <label><input type="checkbox" value="single-origin"> Single Origins</label>
                        <label><input type="checkbox" value="decaf"> Include Decaf</label>
                    </div>
                    <button type="submit" class="btn btn-primary">Start My Subscription ☀️</button>
                </form>
                <div class="modal-guarantee">
                    🛡️ 100% Satisfaction Guarantee • Cancel Anytime • Free Shipping
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
    
    // Handle form submission
    modal.querySelector('form').addEventListener('submit', handleSignup);
}

function closeModal() {
    const modal = document.querySelector('.signup-modal');
    if (modal) {
        modal.remove();
        document.body.style.overflow = '';
    }
}

function handleSignup(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    
    // Simulate signup success
    setTimeout(() => {
        alert('🎉 Welcome to FloridaBrew! Check your email for confirmation and your first shipment details.');
        closeModal();
    }, 1000);
    
    // Track conversion
    trackConversion('signup_completed');
}

function trackConversion(action) {
    // Analytics tracking
    console.log('🔥 Conversion tracked:', action);
    
    // In real implementation, send to analytics
    if (typeof gtag !== 'undefined') {
        gtag('event', 'conversion', {
            send_to: 'AW-CONVERSION_ID/FloridaBrew_Signup',
            value: action === 'signup_completed' ? 39.0 : 0.0,
            currency: 'USD'
        });
    }
}

// Floating elements animation
function animateFloatingElements() {
    const elements = document.querySelectorAll('.element');
    elements.forEach((el, index) => {
        el.style.animation = `float ${3 + index}s ease-in-out infinite`;
        el.style.animationDelay = `${index * 0.5}s`;
    });
}

// Initialize floating animations when page loads
setTimeout(animateFloatingElements, 1000);

// Add modal styles
const modalStyles = `
    <style>
    .signup-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        animation: fadeIn 0.3s ease-in;
    }
    
    .modal-content {
        background: white;
        border-radius: 15px;
        max-width: 500px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
        animation: slideUp 0.3s ease-out;
    }
    
    .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 2rem;
        border-bottom: 1px solid #eee;
    }
    
    .close-modal {
        background: none;
        border: none;
        font-size: 2rem;
        cursor: pointer;
        color: #999;
    }
    
    .modal-body {
        padding: 2rem;
    }
    
    .signup-form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin: 1.5rem 0;
    }
    
    .signup-form input {
        padding: 1rem;
        border: 2px solid #ddd;
        border-radius: 8px;
        font-size: 1rem;
    }
    
    .coffee-preferences {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin: 1rem 0;
    }
    
    .coffee-preferences label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9rem;
    }
    
    .modal-guarantee {
        text-align: center;
        font-size: 0.875rem;
        color: #666;
        margin-top: 1rem;
        padding-top: 1rem;
        border-top: 1px solid #eee;
    }
    
    .frequency-selector {
        margin: 1rem 0;
        padding: 1rem;
        background: rgba(212, 165, 116, 0.1);
        border-radius: 8px;
    }
    
    .frequency-selector label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 600;
        color: var(--secondary-color);
    }
    
    .frequency-selector select {
        width: 100%;
        padding: 0.5rem;
        border: 1px solid var(--primary-color);
        border-radius: 5px;
        font-size: 0.9rem;
    }
    
    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    
    @keyframes slideUp {
        from { transform: translateY(50px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
    }
    </style>
`;

document.head.insertAdjacentHTML('beforeend', modalStyles);