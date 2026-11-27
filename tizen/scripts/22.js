(function(){
  "use strict";
  var lastCode=0,lastAt=0;
  var ARROWS={37:1,38:1,39:1,40:1};
  window.addEventListener("keydown",function(e){
    var code=e.keyCode||({ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40}[e.key]||0);
    if(!ARROWS[code]||typeof currentScreen!=="undefined"&&currentScreen!=="main")return;
    var target=e.target;
    if(target&&(target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName||"")))return;
    if(e.cancelable)e.preventDefault();
    var now=Date.now();
    /* Samsung remotes can emit a rapid duplicate keydown for one press.
       Consume the browser's native scroll and coalesce same-direction events. */
    if(code===lastCode&&now-lastAt<130){
      e.stopImmediatePropagation();
      e.stopPropagation();
      return;
    }
    lastCode=code;
    lastAt=now;
  },true);
})();