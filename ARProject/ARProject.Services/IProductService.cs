using ARProject.Models;
using System.Collections.Generic;

namespace ARProject.Services
{
    public interface IProductService
    {
        Product GetProductById(int id);

        IEnumerable<Product> GetAll();
    }
}