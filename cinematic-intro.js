/* THE LAST OF FPL — cinematic entrance controller */
(() => {
    const intro = document.getElementById("cinematicIntro");
    if (!intro) return;

    const storageKey = "tlofpl-cinematic-intro-seen";

    const cleanupIntro = () => {
        if (!intro.isConnected) return;
        intro.remove();
        document.querySelector(".nav-btn")?.focus();
    };

    const finishIntro = () => {
        if (!intro.isConnected) return;
        document.body.classList.remove("intro-pending");
        document.body.classList.add("intro-complete");
        intro.classList.add("is-leaving");

        const handleAnimationEnd = (event) => {
            if (event.target === intro && intro.classList.contains("is-leaving")) {
                intro.removeEventListener("animationend", handleAnimationEnd);
                cleanupIntro();
            }
        };
        intro.addEventListener("animationend", handleAnimationEnd);

        setTimeout(() => {
            if (intro.isConnected && intro.classList.contains("is-leaving")) {
                intro.removeEventListener("animationend", handleAnimationEnd);
                cleanupIntro();
            }
        }, 1200);
    };

    window.enterTournament = () => {
        try {
            window.sessionStorage.setItem(storageKey, "1");
        } catch (error) {
            // The intro still works when storage is unavailable.
        }
        finishIntro();
    };

    let alreadySeen = false;
    try {
        alreadySeen = window.sessionStorage.getItem(storageKey) === "1";
    } catch (error) {
        alreadySeen = false;
    }

    if (alreadySeen) {
        document.body.classList.add("intro-complete");
        intro.remove();
    } else {
        document.body.classList.add("intro-pending");
        intro.querySelector(".cinematic-enter-btn")?.focus({ preventScroll: true });
    }
})();
