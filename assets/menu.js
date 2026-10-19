/* Pizza Mia menu data (Pizza Mia Menu 2026) — shared by order.html, the chat widget and the offers function.
   After changing it, regenerate the AI host menu in netlify/functions/chat.js. */
(function () {
  "use strict";
  // Half & Half: allowed on these pizza size indexes (Large, Godfather, Jumbo).
  // Price = half of each pizza's price at that size (each half rounded up), added together.
  var HALF_SIZES = [1,2,3];
  // Optional extras on any item, e.g. {must:true} for the "Must Try" badge,
  // {choice:{label,opts}} for a required pick (Penne/Spaghetti), {toppings:true}.
  function ext(o,x){ if (x) for (var k in x) o[k]=x[k]; return o; }
  function pz(id,name,desc,veg,img,s,x){ return ext({id:id,name:name,desc:desc,veg:veg,img:img,type:"pizza",sizes:s},x); }
  function mu(id,name,desc,veg,img,s,x){ return ext({id:id,name:name,desc:desc,veg:veg,img:img,type:"multi",sizes:s},x); }
  function sg(id,name,desc,veg,img,p,x){ return ext({id:id,name:name,desc:desc,veg:veg,img:img,type:"single",price:p},x); }
  var MUST = {must:true};
  var PASTA_X = {choice:{label:"Choose pasta", opts:["Penne","Spaghetti"]}, toppings:true};

  var PIZZAS = [
    { group:"Vegetarian", items:[
      pz("bragveg","Braganza Bonanza Veg","Pineapple, Spinach, Feta, Jalapeños & Corn",true,"braganza-bonanza-veg.jpg",[699,999,1399,1849],MUST),
      pz("medi","Mediterranean","Feta, Sun-dried Tomato & Olive",true,"mediterranean.jpg",[699,1099,1449,1849]),
      pz("spinfeta","Spinach and Feta","Sauté Spinach, Feta & Olive",true,"spinach-feta.jpg",[629,1049,1299,1799]),
      pz("paneer","Paneer Tikka","Paneer & Coriander",true,"paneer-tikka.jpg",[579,899,1249,1699]),
      pz("mozz","Mozzarella and Basil","Buffalo Mozzarella & Basil Leaves",true,"mozzarella-basil.jpg",[599,949,1349,1849]),
      pz("garden","Garden","Mushroom, Capsicum, Onion & Tomato",true,"garden.jpg",[479,729,979,1299]),
      pz("marg","Margherita","Cheese",true,"margherita.jpg",[399,679,929,1249])
    ]},
    { group:"Chicken", items:[
      pz("bragch","Braganza Bonanza","Chicken Tikka, Chicken Keema, Chicken Paprika, BBQ Chicken, Pineapple & Jalapeños",false,"braganza-bonanza.jpg",[999,1399,1949,2599],MUST),
      pz("chbbq","Chicken BBQ","BBQ Chicken & Capsicum",false,"chicken-bbq.jpg",[649,1049,1399,1849],MUST),
      pz("chtikka","Chicken Tikka","Chicken Tikka & Onion",false,"chicken-tikka.jpg",[749,1199,1499,2049]),
      pz("smokpap","Smoked Paprika","Chicken Paprika, Yellow Capsicum & Onion",false,"smoked-paprika.jpg",[799,1230,1599,2140]),
      pz("chkeema","Chicken Keema","Chicken Keema & Spring Onion",false,"chicken-keema.jpg",[679,1049,1449,1699]),
      pz("chsaus","Chicken Sausages","Chicken Sausage, Mushroom & Green Olives",false,"chicken-sausages.jpg",[649,999,1299,1849])
    ]},
    { group:"Pork", items:[
      pz("pep","Pepperoni","Pepperoni",false,"pepperoni.jpg",[699,1299,1699,2199],MUST),
      pz("chorizo","Goan Chorizo","Chorizo",false,"goan-chorizo.jpg",[779,1249,1649,2099],MUST),
      pz("bacon","Bacon & Onion","Bacon & Caramelised Onion",false,"bacon-onion.jpg",[849,1449,1849,2549]),
      pz("hawaii","Hawaiian","Pineapple, Ham & Sweet Corn",false,"hawaiian.jpg",[699,1099,1499,1949]),
      pz("flamsal","Flaming Salami","Salami, Red Pepper, Chilli Flakes & Mushroom",false,"flaming-salami.jpg",[749,1195,1649,2099]),
      pz("smoksal","Smoked Salami","Salami, Buffalo Mozzarella & Cherry Tomato",false,"smoked-salami.jpg",[829,1349,1899,2599])
    ]},
    { group:"Sea Food", items:[
      pz("tuna","Tuna Onion Chilli","Tuna, Onion & Green Chilli",false,"tuna-onion-chilli.jpg",[729,1149,1549,1949])
    ]}
  ];

  var STARTERS = [
    sg("garlicveg","Garlic Butter Vegetables","Vegetables tossed in garlic butter",true,"garlic-butter-vegetables.jpg",300),
    sg("wedges","Potato Wedges","Crispy seasoned potato wedges",true,"potato-wedges.jpg",250),
    mu("garlicknots","Garlic Knots","Freshly baked, brushed with garlic butter",true,"garlic-knots.jpg",[{label:"2 pcs",price:180},{label:"4 pcs",price:300}]),
    mu("cheeseknots","Cheese Garlic Knots","Garlic knots loaded with melted cheese",true,"cheese-garlic-knots.jpg",[{label:"2 pcs",price:250},{label:"4 pcs",price:400}],MUST)
  ];

  var CHEESE_KNOTS = [
    sg("chilliknots","Chilli Cheese Knots","2 pcs · cheese knots with a chilli kick",true,"chilli-cheese-knots.jpg",250),
    sg("mushknots","Mushroom Cheese Knots","2 pcs · cheese knots with mushroom",true,"mushroom-cheese-knots.jpg",275),
    sg("keemaknots","Chicken Keema Cheese Knots","2 pcs · cheese knots with chicken keema",false,"chicken-keema-cheese-knots.jpg",300),
    sg("chorizoknots","Chorizo Cheese Knots","2 pcs · cheese knots with Goan chorizo",false,"chorizo-cheese-knots.jpg",350),
    sg("baconknots","Bacon Cheese Knots","2 pcs · cheese knots with bacon",false,"bacon-cheese-knots.jpg",350)
  ];

  var PASTA = [
    mu("ptomato","Tomato Sauce Pasta","Penne or spaghetti in classic tangy tomato sauce",true,"pasta-tomato.jpg",[{label:"Regular",price:300},{label:"Large",price:450}],PASTA_X),
    mu("pcheese","Cheese Sauce Pasta","Penne or spaghetti in rich, creamy cheese sauce",true,"pasta-cheese.jpg",[{label:"Regular",price:330},{label:"Large",price:499}],PASTA_X),
    mu("ppesto","Pesto Sauce Pasta","Penne or spaghetti in fresh basil pesto",true,"pasta-pesto.jpg",[{label:"Regular",price:350},{label:"Large",price:550}],PASTA_X),
    mu("palio","Aglio e Olio","Penne or spaghetti with garlic, olive oil & chilli flakes",true,"pasta-aglio-olio.jpg",[{label:"Regular",price:330},{label:"Large",price:499}],PASTA_X),
    mu("p3sauce","3 Sauce Pasta","Penne or spaghetti in our three-sauce blend",true,"pasta-3-sauce.jpg",[{label:"Regular",price:380},{label:"Large",price:550}],PASTA_X)
  ];

  var DESSERTS = [
    sg("brownie","Chocolate Brownie","Warm, fudgy chocolate brownie",true,"brownie.jpg",250)
  ];

  // Dine-in only: shown to tempt people to visit, not orderable online
  function dn(id,name,desc,veg,img,price,x){ return ext({id:id,name:name,desc:desc,veg:veg,img:img,type:"dinein",price:price},x); }
  var DINEIN = [
    dn("mini99","₹99 Mini Margherita","Our classic Margherita in a 6 inch size, made for little hands and little appetites.",true,"margherita.jpg",99),
    dn("vegcombo","Veg Combo","Margherita Pizza + Garlic Knots + Fresh Lime Juice",true,"margherita.jpg",400),
    dn("nvcombo","Non-Veg Combo","Chicken Keema Pizza + Garlic Knots + Fresh Lime Juice",false,"chicken-keema.jpg",500),
    dn("chipsveg","Chips in a Bag — Veg","Crunchy loaded chips",true,"chips-veg.jpg",250),
    dn("chipsch","Chips in a Bag — Chicken","Loaded chips topped with chicken",false,"chips-chicken.jpg",300),
    dn("sundae","Chocolate Brownie Sundae","The perfect end to a pizza night",true,"brownie-sundae.jpg",399),
    dn("susegad","Susegad Sunset","Gin, Vodka, White Rum, Tequila, Orange & Ginger Ale",null,"susegad-sunset.jpg",null),
    dn("yummymummy","Yummy Mummy","Gin, Cranberry, Apple & Ginger Ale",null,"yummy-mummy.jpg",null,MUST),
    dn("shandy","Miramar Shandy","Kingfisher Beer, White Rum, Orange, Lemon & Mint",null,"miramar-shandy.jpg",null),
    dn("whisklatte","Whisk-a-Latte","Whiskey & Coffee, under a Coconut Shell",null,"whisk-a-latte.jpg",null)
  ];

  // Add-on toppings: prices indexed to pizza size [Medium, Large, Godfather, Jumbo].
  // Pasta uses the Medium price for Regular and the Large price for Large.
  function tp(name,veg,p){ return {name:name,veg:veg,prices:p}; }
  var TOPPINGS = [
    tp("Mushroom",true,[65,75,90,110]), tp("Green Capsicum",true,[65,75,90,110]),
    tp("Yellow Capsicum",true,[75,95,105,115]), tp("Red Capsicum",true,[75,95,105,115]),
    tp("Fresh Onions",true,[40,55,65,75]), tp("Caramelised Onions",true,[65,75,90,110]),
    tp("Fresh Tomatoes",true,[65,75,90,110]), tp("Cherry Tomatoes",true,[75,90,115,135]),
    tp("Sun-dried Tomatoes",true,[95,120,150,175]), tp("Black Olives",true,[95,120,150,175]),
    tp("Green Olives",true,[95,120,150,175]), tp("Green Chilli",true,[35,40,50,60]),
    tp("Jalapeños",true,[95,120,150,175]), tp("Sauté Spinach",true,[60,75,95,110]),
    tp("Pineapple",true,[65,80,95,110]), tp("Sweet Corn",true,[65,80,95,110]),
    tp("Fresh Basil",true,[55,65,75,95]), tp("Garlic",true,[40,50,60,75]),
    tp("Double Cheese",true,[120,175,225,275]), tp("Buffalo Mozzarella",true,[135,185,240,295]),
    tp("Feta",true,[125,170,215,265]), tp("Paneer",true,[110,155,195,235]),
    tp("BBQ Chicken",false,[125,165,205,235]), tp("Chicken Tikka",false,[125,165,205,235]),
    tp("Chicken Keema",false,[125,165,205,235]), tp("Chicken Paprika",false,[150,175,205,235]),
    tp("Sauté Chicken",false,[125,165,205,235]), tp("Chorizo",false,[155,235,270,310]),
    tp("Pepperoni",false,[195,330,450,560]), tp("Bacon",false,[180,275,395,495]),
    tp("Ham",false,[130,150,175,205])
  ];
  var NO_MEAT_ADDONS = { marg:true };   // "Meat add-ons not available on Margherita"

  var SECTIONS = [
    { id:"pizzas", label:"Pizzas", groups:PIZZAS },
    { id:"starters", label:"Starters", items:STARTERS },
    { id:"cknots", label:"Cheese Knots", items:CHEESE_KNOTS },
    { id:"pasta",  label:"Pasta", items:PASTA },
    { id:"desserts", label:"Desserts", items:DESSERTS },
    { id:"dinein", label:"Dine-in", items:DINEIN }
  ];

  var PM_MENU = { HALF_SIZES:HALF_SIZES, PIZZAS:PIZZAS, TOPPINGS:TOPPINGS, NO_MEAT_ADDONS:NO_MEAT_ADDONS, SECTIONS:SECTIONS };
  // Browser: window.PM_MENU. Server (offers function): require() so prices are checked against the same data.
  if (typeof module !== "undefined" && module.exports) module.exports = PM_MENU;
  else window.PM_MENU = PM_MENU;
})();
