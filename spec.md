# Martura Handmade - Especificacion funcional y tecnica del MVP

## 1. Contexto del proyecto

Martura Handmade es una tienda online en Angular para una marca real de articulos textiles hechos a mano.
El MVP actual prioriza:

- velocidad de desarrollo
- autonomia de la clienta para gestionar catalogo y ajustes basicos
- backend serverless con Firebase
- checkout sin cuenta de cliente
- operativa real de pedidos, stock, promociones y consultas

No hay integraciones de IA activas en esta fase. La idea de usar IA mas adelante sigue abierta, pero no forma parte del alcance actual.


## 2. Decision de producto vigente

Estas son decisiones importantes ya tomadas y reflejadas en el codigo:

- No existen perfiles privados de clientes.
- No existe seccion "Mis pedidos".
- El cliente compra como invitado.
- Para comprar se recogen: nombre, telefono, email, direccion, codigo postal, ciudad, provincia, DNI y comentarios opcionales.
- El pago actual no pasa por TPV ni pasarela automatica. El flujo es Bizum.
- El numero Bizum es configurable desde administracion.
- El precio de envio es configurable desde administracion.
- Hay dashboard privado solo para administradoras.
- El acceso admin se valida con Google Sign-In y lista blanca de correos admin.
- Los pedidos se crean desde Cloud Functions, no desde reglas cliente ni logica confiada al frontend.
- El stock se reserva/libera en backend segun el estado del pedido.
- Existen campañas y codigos de descuento.
- Un producto puede relacionarse con varias categorias, subcategorias y colecciones.
- Las subcategorias se relacionan con categorias compatibles.
- La Home es corta: carrusel, acceso a catalogo y destacados.
- La seccion "Sobre mi" es configurable desde el dashboard.
- La seccion "Consultas" registra el mensaje y envia email al admin.


## 3. Stack tecnico

### Frontend

- Angular 20
- Angular Material (spinner y algunos componentes utilitarios)
- AngularFire
- RxJS
- SweetAlert2 para modales, confirmaciones y feedback

### Backend

- Firebase Hosting
- Firestore
- Firebase Storage
- Firebase Authentication
- Firebase Functions 2nd gen
- Nodemailer para salida SMTP

### Ficheros base

- Front principal: [src/app](C:\Users\gabra\Documents\TiendaVirginia\src\app)
- Backend Functions: [functions/src/index.ts](C:\Users\gabra\Documents\TiendaVirginia\functions\src\index.ts)
- Reglas Firestore: [firestore.rules](C:\Users\gabra\Documents\TiendaVirginia\firestore.rules)
- Reglas Storage: [storage.rules](C:\Users\gabra\Documents\TiendaVirginia\storage.rules)
- Config Firebase: [firebase.json](C:\Users\gabra\Documents\TiendaVirginia\firebase.json)


## 4. Modos de ejecucion

El proyecto soporta dos modos:

### 4.1 Modo Firebase real

Usa Firestore, Storage, Auth y Functions reales si `environment.firebase.enabled` esta activo y la configuracion existe.

### 4.2 Modo mock/local

Si Firebase no esta configurado, varios servicios caen a `localStorage` y/o seeds mock.
Esto permite seguir desarrollando interfaz y flujos sin depender siempre del backend.

Configuracion central:

- [src/app/core/firebase/firebase.config.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\firebase\firebase.config.ts)
- [src/app/core/firebase/firebase.lazy.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\firebase\firebase.lazy.ts)
- [src/environments/environment.ts](C:\Users\gabra\Documents\TiendaVirginia\src\environments\environment.ts)
- [src/environments/environment.development.ts](C:\Users\gabra\Documents\TiendaVirginia\src\environments\environment.development.ts)
- [src/environments/environment.local.ts](C:\Users\gabra\Documents\TiendaVirginia\src\environments\environment.local.ts)


## 5. Rutas publicas y privadas

Definidas en [src/app/app.routes.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\app.routes.ts).

### Publicas

- `/` -> Home
- `/catalogo` -> Catalogo
- `/sobre-mi` -> Sobre mi
- `/producto/:slug` -> Detalle de producto
- `/carrito` -> Carrito
- `/checkout` -> Checkout
- `/consultas` -> Formulario de consultas
- `/login` -> Acceso Google para admin

### Privada

- `/admin` -> Dashboard privado, protegido por `adminGuard`


## 6. Header, navegacion y comportamiento global

La shell principal vive en [src/app/app.html](C:\Users\gabra\Documents\TiendaVirginia\src\app\app.html).

Comportamiento relevante:

- Menu publico: Home, Catalogo, Sobre mi, Consultas.
- El carrito solo se muestra si procede y queda deshabilitado visualmente con 0 elementos.
- Si hay una admin autenticada, aparece acceso a Dashboard.
- No existe menu para cuenta cliente porque se elimino ese alcance.
- El footer muestra el correo de contacto configurado en ajustes.


## 7. Autenticacion y roles

### 7.1 Rol activo real

En la practica, el rol importante es `admin`.

### 7.2 Correos admin actuales

La lista blanca de admins esta en:

- [src/environments/environment.ts](C:\Users\gabra\Documents\TiendaVirginia\src\environments\environment.ts)
- [firestore.rules](C:\Users\gabra\Documents\TiendaVirginia\firestore.rules)
- [storage.rules](C:\Users\gabra\Documents\TiendaVirginia\storage.rules)
- [functions/src/index.ts](C:\Users\gabra\Documents\TiendaVirginia\functions\src\index.ts)

Correos contemplados ahora:

- `gabramsua@gmail.com`
- `martura.handmade@gmail.com`

### 7.3 Servicio de auth

Vive en [src/app/core/services/auth.service.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\services\auth.service.ts).

Reglas actuales:

- En produccion usa Google popup.
- En emuladores puede crear o reutilizar un usuario tecnico.
- Si alguien intenta entrar como admin con un correo no autorizado, se cierra sesion y se muestra error.
- No existe flujo de login cliente activo como feature del negocio, aunque el modelo `customer` sigue existiendo de forma residual en algunos ficheros legacy.


## 8. Home publica

Implementada en:

- [src/app/features/home/home.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\features\home\home.ts)
- [src/app/features/home/home.html](C:\Users\gabra\Documents\TiendaVirginia\src\app\features\home\home.html)

Que muestra:

- Carrusel principal configurable desde ajustes
- CTA hacia catalogo y consultas
- Mensaje de pago por Bizum
- Productos destacados
- Boton compartir en destacados

Detalles:

- El carrusel rota automaticamente cada 5 segundos
- Los slides activos salen de `shopSettings.heroSlides`
- Los productos destacados salen de `productsService.featuredProducts$`


## 9. Catalogo publico

Implementado en:

- [src/app/features/catalog/catalog.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\features\catalog\catalog.ts)
- [src/app/features/catalog/catalog.html](C:\Users\gabra\Documents\TiendaVirginia\src\app\features\catalog\catalog.html)

Funcionalidades:

- listado de productos visibles
- filtro por categoria
- filtro por subcategoria
- filtro por coleccion
- busqueda por texto
- filtro "solo promociones"
- orden por novedades, precio ascendente, precio descendente y nombre
- ver campaña aplicada y su ventana temporal
- compartir producto
- añadir al carrito desde tarjeta
- feedback visual cuando un producto ya esta añadido

Los filtros viven en `ProductsService` y no solo en el componente.


## 10. Detalle de producto

Implementado en:

- [src/app/features/product-detail/product-detail.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\features\product-detail\product-detail.ts)
- [src/app/features/product-detail/product-detail.html](C:\Users\gabra\Documents\TiendaVirginia\src\app\features\product-detail\product-detail.html)

Funcionalidades:

- galeria de imagenes
- selector implicito por talla/variante cuando existen tallas
- añadir al carrito por talla
- ver campaña activa y fechas
- mostrar Bizum configurado
- compartir producto
- mostrar taxonomias asociadas


## 11. Carrito y checkout

### 11.1 Carrito

El carrito usa un servicio dedicado y guarda lineas por producto + variante.
La logica esta en:

- [src/app/core/services/cart.service.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\services\cart.service.ts)
- [src/app/features/cart/cart.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\features\cart\cart.ts)

### 11.2 Checkout

Implementado en:

- [src/app/features/checkout/checkout.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\features\checkout\checkout.ts)
- [src/app/core/services/order-placement.service.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\services\order-placement.service.ts)

Campos del formulario:

- nombre
- email
- telefono
- DNI
- direccion
- codigo postal
- ciudad
- provincia
- comentarios
- codigo de descuento
- aceptacion de politicas

Comportamiento:

- valida campos con mensajes legibles
- previsualiza descuento si existe
- recalcula total final
- crea pedido por Cloud Function `createOrder`
- limpia el carrito al completarse
- muestra referencia de pedido y numero Bizum al finalizar

Decision importante:

- El frontend no decide stock ni total final como fuente de verdad.
- El backend revalida productos, stock, descuentos y precios antes de persistir.


## 12. Modelo de productos

Definido en [src/app/core/models/product.model.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\models\product.model.ts).

Campos importantes:

- `name`
- `slug`
- `position`
- `description`
- `story`
- `originalPrice`
- `offerPrice`
- `imageUrl`
- `gallery`
- `stock`
- `sizes`
- `colors`
- `pricingMode`
- `campaignIds`
- `featured`
- `status`

Relacion taxonomica:

- `categories` / `categorySlugs`
- `subcategories` / `subcategorySlugs`
- `collections` / `collectionSlugs`

Compatibilidad legacy:

- siguen existiendo campos simples (`category`, `subcategory`, `collection`) para convivencia y migracion
- los helpers normalizan ambos mundos


## 13. Precios, ofertas y promociones

### 13.1 Modos de precio por producto

`ProductPricingMode`:

- `regular`
- `individual_offer`
- `campaign`

### 13.2 Regla de negocio actual

- No se apilan campañas.
- Si un producto tiene campañas activas, se toma la mejor oferta valida segun `resolveProductPricing`.
- Si un producto tiene oferta individual y `pricingMode = individual_offer`, se usa esa.
- Los codigos de descuento pueden aplicar a todo el pedido o solo a productos concretos.

Lugares clave:

- [src/app/core/utils/product-pricing.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\utils\product-pricing.ts)
- [src/app/core/services/campaigns.service.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\services\campaigns.service.ts)
- [src/app/core/services/discount-codes.service.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\services\discount-codes.service.ts)
- [functions/src/index.ts](C:\Users\gabra\Documents\TiendaVirginia\functions\src\index.ts)


## 14. Clasificacion del catalogo

El dashboard llama "Clasificacion" a la gestion de:

- categorias
- subcategorias
- colecciones

Estado actual:

- Un producto puede tener varias categorias.
- Un producto puede tener varias subcategorias.
- Un producto puede tener varias colecciones.
- Una subcategoria puede restringirse a categorias compatibles.
- Categorias y subcategorias se ordenan alfabeticamente.
- Colecciones mantienen `position` para orden manual.

Modelo:

- [src/app/core/models/taxonomy.model.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\models\taxonomy.model.ts)

Servicio:

- [src/app/core/services/taxonomies.service.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\services\taxonomies.service.ts)


## 15. Dashboard privado

Implementado en:

- [src/app/features/admin/admin.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\features\admin\admin.ts)
- [src/app/features/admin/admin.html](C:\Users\gabra\Documents\TiendaVirginia\src\app\features\admin\admin.html)
- [src/app/features/admin/admin.css](C:\Users\gabra\Documents\TiendaVirginia\src\app\features\admin\admin.css)

Vistas principales:

### 15.1 Pedidos

- tabla/accordion de pedidos
- filtro por texto
- filtro por estado
- filtro por fecha desde/hasta
- cambio de estado
- cancelacion
- detalle de lineas y datos del cliente

Estados vigentes:

- `in_factory` -> En fabrica
- `accepted` -> Aceptado
- `shipped` -> Enviado
- `delivered` -> Entregado
- `cancelled` -> Cancelado

### 15.2 Catalogo

- tabla ordenable por nombre, orden, clasificacion, precio, promo, estado y stock
- busqueda
- filtros por categoria y subcategoria
- edicion rapida desde el listado

### 15.3 Producto

- alta y edicion de producto
- subida de imagenes a Storage
- gestion de galeria
- orden de galeria
- imagen principal
- asignacion de categorias, subcategorias, colecciones y campañas
- tallas, colores, stock, featured y estado

### 15.4 Clasificacion

- CRUD de categorias
- CRUD de subcategorias
- CRUD de colecciones
- relacion categorias/subcategorias

### 15.5 Promociones

- CRUD de campañas
- CRUD de codigos de descuento
- asignacion de productos a campañas
- asignacion de productos a codigos
- control de activacion y fechas

### 15.6 Ajustes

- telefono Bizum
- precio de envio
- correo de contacto
- contenido de "Sobre mi"
- articulos/cards de "Sobre mi"
- carrusel principal
- boton de borrado total de datos


## 16. Sobre mi configurable

Ya no es contenido hardcodeado.

Se configura via:

- `aboutTitle`
- `aboutBody`
- `aboutArticles[]`

Modelo:

- [src/app/core/models/shop-settings.model.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\models\shop-settings.model.ts)

Servicio:

- [src/app/core/services/shop-settings.service.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\services\shop-settings.service.ts)

Pantalla publica:

- [src/app/features/about/about.html](C:\Users\gabra\Documents\TiendaVirginia\src\app\features\about\about.html)


## 17. Ajustes de tienda

Documento de ajustes:

- coleccion Firestore: `shopSettings`
- documento principal esperado: `default`

Campos operativos actuales:

- `bizumPhone`
- `shippingPrice`
- `contactEmail`
- `aboutTitle`
- `aboutBody`
- `aboutArticles`
- `heroSlides`


## 18. Pedidos y stock

Modelo en:

- [src/app/core/models/order.model.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\models\order.model.ts)

### Regla de oro del backend

La logica critica de pedido vive en Functions:

- `createOrder`
- `updateOrderStatus`

Flujo actual:

1. El frontend manda datos del pedido.
2. `createOrder` valida cliente, items y codigo.
3. Lee productos, campañas y ajustes.
4. Calcula el precio real item a item.
5. Aplica descuento si corresponde.
6. Reserva stock en transaccion.
7. Persiste pedido.
8. Devuelve pedido serializado al frontend.

Cuando se cambia un estado:

- si pasa a `cancelled`, se libera stock
- si un pedido cancelado vuelve a un estado activo, se vuelve a reservar stock

Esto evita dejar la integridad del inventario en manos del cliente.


## 19. Formato de codigo de pedido

Los codigos de pedido son alfanumericos, en mayusulas, de 8 caracteres, usando un alfabeto sin caracteres ambiguos.

Fuente:

- [functions/src/index.ts](C:\Users\gabra\Documents\TiendaVirginia\functions\src\index.ts)
- [src/app/core/utils/order-code.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\utils\order-code.ts) si se reutiliza en front


## 20. Consultas

Implementado en:

- [src/app/features/contact/contact.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\features\contact\contact.ts)
- [src/app/core/services/contact-messages.service.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\services\contact-messages.service.ts)

Que hace:

- valida nombre, email y cuerpo
- crea un documento en `contactMessages`
- dispara un email al admin via trigger backend


## 21. Emails transaccionales

Implementados en [functions/src/index.ts](C:\Users\gabra\Documents\TiendaVirginia\functions\src\index.ts).

Escenarios cubiertos:

1. Creacion de pedido
   - email al cliente
   - email al admin

2. Cambio de estado del pedido
   - email al cliente

3. Nueva consulta
   - email al admin

Tecnologia:

- `nodemailer`
- SMTP via secretos de Firebase Functions

Secrets requeridos:

- `SMTP_USER`
- `SMTP_PASS`

Variables opcionales:

- `SMTP_HOST` (por defecto `smtp.gmail.com`)
- `SMTP_PORT` (por defecto `465`)
- `SMTP_SECURE` (por defecto `true`)
- `MAIL_FROM`

Importante:

- Si el envio de email falla, el pedido o la consulta no se descartan.
- El fallo queda en logs, pero no rompe la operativa principal.


## 22. Borrado total de datos

Existe una accion de administracion para reiniciar el MVP:

- boton rojo en Ajustes
- confirmacion previa
- llamada a `wipeStoreData`

Que borra:

- productos
- campañas
- categorias
- subcategorias
- colecciones
- codigos de descuento
- pedidos
- consultas
- settings
- imagenes de productos
- imagenes de hero

Que no borra:

- codigo fuente
- Cloud Functions
- reglas Firestore
- reglas Storage
- configuracion del proyecto Firebase

Servicio frontend:

- [src/app/core/services/admin-maintenance.service.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\services\admin-maintenance.service.ts)


## 23. Firestore: colecciones activas

Colecciones esperadas en [src/app/core/firebase/firebase.config.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\firebase\firebase.config.ts):

- `products`
- `campaigns`
- `discountCodes`
- `orders`
- `productCategories`
- `productSubcategories`
- `productCollections`
- `shopSettings`
- `contactMessages`
- `customers` (residual/legacy, ya no es parte del flujo de negocio actual)


## 24. Storage

Prefijos relevantes:

- `products/` -> imagenes de producto
- `hero-slides/` -> imagenes del carrusel principal

Las reglas permiten escritura solo a admins.


## 25. Seguridad

### Firestore

Resumen de [firestore.rules](C:\Users\gabra\Documents\TiendaVirginia\firestore.rules):

- lectura publica de productos, campañas, codigos, taxonomias y ajustes
- escritura solo admin
- `orders` no se crean ni actualizan desde cliente
- `contactMessages` se pueden crear publicamente, pero solo admin puede leerlos

### Storage

Resumen de [storage.rules](C:\Users\gabra\Documents\TiendaVirginia\storage.rules):

- lectura publica de imagenes
- escritura solo admin en `products/**` y `hero-slides/**`


## 26. Seeds y datos mock

Hay datos mock y catalogo de apoyo en:

- [src/app/core/data/mock-products.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\data\mock-products.ts)
- [src/app/core/data/mock-campaigns.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\data\mock-campaigns.ts)

Siguen siendo utiles para desarrollo, pero el objetivo real es que la clienta gestione catalogo desde dashboard.


## 27. Scripts utiles

### Front

```bash
npm run start
npm run build
```

### Functions

```bash
npm --prefix functions run build
```

### Deploy parcial

```bash
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules,storage
```

### Deploy completo

```bash
firebase deploy
```


## 28. Estado funcional del MVP a dia de este documento

El MVP ya cubre, funcionalmente:

- catalogo publico navegable
- detalle de producto
- carrito
- checkout invitado
- creacion de pedido real en backend
- gestion de stock ligada a pedido
- dashboard admin
- CRUD de productos
- CRUD de clasificaciones
- CRUD de campañas
- CRUD de codigos de descuento
- ajustes de tienda
- carrusel configurable
- "Sobre mi" configurable
- consultas
- correos de pedido / estado / consultas
- reinicio total de datos del MVP


## 29. Limitaciones y deuda conocida

Pendientes o puntos a vigilar:

- No hay pasarela de pago automatizada; Bizum sigue siendo manual.
- No hay perfil cliente ni historico privado para clientas.
- No hay panel de analitica real.
- No hay suite E2E formal aun.
- Hay restos legacy de customer/user que ya no representan el flujo final del negocio.
- Hay algunos textos con problemas de codificacion en partes del codigo fuente; conviene hacer una pasada global de normalizacion UTF-8 cuando no haya presion funcional.
- `firebase-functions` emite aviso de version antigua; funciona, pero conviene planificar upgrade controlado.


## 30. Siguiente persona que toque el proyecto: por donde empezar

Si alguien retoma el proyecto despues de tiempo, el orden recomendado es:

1. Leer este documento.
2. Revisar [src/app/app.routes.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\app.routes.ts).
3. Revisar modelos en [src/app/core/models](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\models).
4. Revisar servicios de dominio:
   - [products.service.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\services\products.service.ts)
   - [campaigns.service.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\services\campaigns.service.ts)
   - [discount-codes.service.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\services\discount-codes.service.ts)
   - [shop-settings.service.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\services\shop-settings.service.ts)
   - [orders.service.ts](C:\Users\gabra\Documents\TiendaVirginia\src\app\core\services\orders.service.ts)
5. Revisar el backend en [functions/src/index.ts](C:\Users\gabra\Documents\TiendaVirginia\functions\src\index.ts).
6. Confirmar secrets SMTP y reglas Firebase antes de tocar produccion.


## 31. Resumen ejecutivo

Lo construido ya no es una demo vacia: es un MVP operativo de tienda con administracion privada, catalogo gestionable, checkout invitado, pricing con promociones, pedidos consistentes en backend, stock acoplado a estados y correo transaccional basico.

La siguiente fase natural ya no es "montar la base", sino mejorar:

- experiencia de cliente
- pasarela de pago definitiva
- calidad visual final
- automatizaciones
- pruebas y endurecimiento de produccion
