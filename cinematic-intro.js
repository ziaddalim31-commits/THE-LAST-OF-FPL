/* THE LAST OF FPL — cinematic entrance controller */
(() => {
    const intro = document.getElementById("cinematicIntro");
    if (!intro) return;

    const storageKey = "tlofpl-cinematic-intro-seen";

    const finishIntro = () => {
        if (!intro.isConnected) return;
        document.body.classList.remove("intro-pending");
        document.body.classList.add("intro-complete");
        intro.classList.add("is-leaving");
    };

    window.enterTournament = () => {
        try {
            window.sessionStorage.setItem(storageKey, "1");
        } catch (error) {
            // The intro still works when storage is unavailable.
        }
        finishIntro();
    };

    intro.addEventListener("animationend", event => {
        if (event.target === intro && intro.classList.contains("is-leaving")) {
            intro.remove();
        }
    });

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
    }
})();
