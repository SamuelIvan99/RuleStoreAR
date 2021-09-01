using ARProject.Models;
using System.Collections.Generic;
using System.Linq;

namespace ARProject.Services
{
    public class ProductService : IProductService
    {
        private List<Product> products = new List<Product>()
        {
            new Product()
            {
                Id = 1,
                Source = "https://cdn.glitch.com/36cb8393-65c6-408d-a538-055ada20431b/Astronaut.glb?1542147958948",
                IOSSource = "https://cdn.glitch.com/36cb8393-65c6-408d-a538-055ada20431b/Astronaut.usdz?v=1569545377878",
                Image = "https://cdn.glitch.com/36cb8393-65c6-408d-a538-055ada20431b%2Fposter-astronaut.png?v=1599079951717",
                QRSource = "https://api.qrserver.com/v1/create-qr-code/?data=https://192.168.0.98:44352/Product/1&amp;size=100x100"
            },
            new Product()
            {
                Id = 2,
                Source = "",
                IOSSource = "",
                Image = "https://images.freeimages.com/images/large-previews/fde/aliens-1-1373417.jpg",
                QRSource = "https://api.qrserver.com/v1/create-qr-code/?data=https://192.168.0.98:44352/Product/2&amp;size=100x100"
            },
            new Product()
            {
                Id = 3,
                Source = "",
                IOSSource = "",
                Image = "https://images.sadhguru.org/sites/default/files/media_files/iso/en/64083-natures-temples.jpg",
                QRSource = "https://api.qrserver.com/v1/create-qr-code/?data=https://192.168.0.98:44352/Product/3&amp;size=100x100"
            },
        };

        public Product GetProductById(int id)
        {
            return products.Where(p => p.Id == id).FirstOrDefault() ?? new Product() { Id = -1, Source = "", IOSSource = "", Image = "" };
        }

        public IEnumerable<Product> GetAll()
        {
            return products;
        }
    }
}
