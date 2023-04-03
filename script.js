document.addEventListener("DOMContentLoaded", function () {
    const hamburger = document.querySelector(".hamburger");
    const navLinks = document.querySelector(".nav-links");

    hamburger.addEventListener("click", function () {
        navLinks.classList.toggle("active");
    });
});

// const route = (e) => {
//     e = e || window.e;
//     e.preventDefault();
//     window.history.pushState({}, "",e.target.href);
// }

// const routes = {
//     "/": "/index.html",
//     "/about": "/about.html",
//     "/register": "/register.html",
//     "/fields": "/fields.html",
//     "/contact": "/contact.html",
//     "/thankyou": "/thankyou.html"
// }

// const handleLocation = async () => {
//     const path = window.location.pathname;
//     const route = routes[path] || routes[404];
//     const html = await fetch(route).then((data) => data.text());
//     document.getElementById("main-content").innerHTML = html
// }

// window.onpopstate = handleLocation;
// window.route = route;

// handleLocation();