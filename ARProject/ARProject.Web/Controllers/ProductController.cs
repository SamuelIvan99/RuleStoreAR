using ARProject.Models;
using ARProject.Services;
using Microsoft.AspNetCore.Mvc;

namespace ARProject.Web.Controllers
{
    [Route("{controller}")]
    public class ProductController : Controller
    {
        private IProductService _productService;

        public ProductController(IProductService productService)
        {
            _productService = productService;
        }

        public IActionResult Index()
        {
            return View();
        }

        [HttpGet("{id}")]
        public IActionResult Details(int id)
        {
            Product product = _productService.GetProductById(id);
            return View(product);
        }
    }
}
